"use client";

import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import type { ActFn, SeasonRow } from "@/components/admin/settings/types";

// Season lifecycle (UR-008, R-097): the manual Open/Closed switch, the
// one-shot auto-flip schedule, and the new-season setup wizard.

/** ISO → the local "YYYY-MM-DDTHH:mm" a datetime-local input wants. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function SeasonScheduleForm({ season, act }: { season: SeasonRow; act: ActFn }) {
  const [opens, setOpens] = useState(toLocalInput(season.opensAt));
  const [closes, setCloses] = useState(toLocalInput(season.closesAt));

  return (
    <div className="mt-1 flex flex-wrap items-end gap-2 text-xs">
      <label>
        Auto-open at
        <Input
          type="datetime-local"
          value={opens}
          onChange={(event) => setOpens(event.target.value)}
          className="mt-0.5 block"
          aria-label={`Auto-open time for ${season.name}`}
        />
      </label>
      <label>
        Auto-close at
        <Input
          type="datetime-local"
          value={closes}
          onChange={(event) => setCloses(event.target.value)}
          className="mt-0.5 block"
          aria-label={`Auto-close time for ${season.name}`}
        />
      </label>
      <Button
        variant="secondary"
        onClick={() =>
          act(
            () =>
              apiFetch(`/api/admin/seasons/${season.id}`, {
                method: "PATCH",
                body: {
                  opensAt: opens ? new Date(opens).toISOString() : null,
                  closesAt: closes ? new Date(closes).toISOString() : null,
                },
              }),
            "Schedule saved. The flip fires once and then clears."
          )
        }
      >
        Save schedule
      </Button>
    </div>
  );
}

export function SeasonStatusCard({
  seasons,
  closedMessage,
  act,
  saveSetting,
}: {
  seasons: SeasonRow[];
  closedMessage: string;
  act: ActFn;
  saveSetting: (key: string, value: unknown, successMessage?: string) => Promise<void>;
}) {
  const [closed, setClosed] = useState(closedMessage);

  return (
    <Card>
      <CardTitle>Store status</CardTitle>
      <p className="mb-3 text-sm text-muted">
        The storefront sells from the open season. Closing it hides checkout everywhere on the next request. A saved
        schedule flips the switch automatically (once) — the manual buttons always win.
      </p>
      <ul className="space-y-4 text-sm">
        {seasons.map((season) => (
          <li key={season.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
            <div className="flex items-center gap-3">
              <span className="font-medium">{season.name}</span>
              <Badge tone={season.status === "OPEN" ? "success" : "neutral"}>{season.status}</Badge>
              <Button
                variant="secondary"
                className="ml-auto"
                onClick={() =>
                  act(
                    () =>
                      apiFetch("/api/admin/season-status", {
                        method: "PATCH",
                        body: { seasonId: season.id, status: season.status === "OPEN" ? "CLOSED" : "OPEN" },
                      }),
                    `${season.name} is now ${season.status === "OPEN" ? "closed" : "open"}.`
                  )
                }
              >
                {season.status === "OPEN" ? "Close store" : "Open store"}
              </Button>
            </div>
            <SeasonScheduleForm season={season} act={act} />
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-border pt-3">
        <label htmlFor="closed-message" className="text-sm font-medium">Storewide closed banner</label>
        <div className="mt-1 flex gap-2">
          <Input id="closed-message" value={closed} onChange={(event) => setClosed(event.target.value)} className="flex-1" />
          <Button onClick={() => saveSetting("store.closed_message", closed)}>Save</Button>
        </div>
      </div>
    </Card>
  );
}

export function NewSeasonCard({ seasons, act }: { seasons: SeasonRow[]; act: ActFn }) {
  const [form, setForm] = useState({ name: "", opensAt: "", closesAt: "", copyFromSeasonId: "" });

  async function create(event: FormEvent) {
    event.preventDefault();
    await act(
      () =>
        apiFetch("/api/admin/seasons", {
          method: "POST",
          body: {
            name: form.name,
            opensAt: form.opensAt ? new Date(form.opensAt).toISOString() : null,
            closesAt: form.closesAt ? new Date(form.closesAt).toISOString() : null,
            copyFromSeasonId: form.copyFromSeasonId || null,
          },
        }),
      `Season "${form.name}" created (closed). Open it when the catalog is ready.`
    );
    setForm({ name: "", opensAt: "", closesAt: "", copyFromSeasonId: "" });
  }

  return (
    <Card>
      <CardTitle>New season</CardTitle>
      <p className="mb-3 text-sm text-muted">
        Sets up next season in one step: copying a catalog brings every product (with options), add-on, and restriction
        along with zeroed stock, and links last season&apos;s items to their copies so repeat orders map automatically.
      </p>
      <form onSubmit={create} className="flex flex-wrap items-end gap-2 text-xs">
        <label>
          Name
          <Input
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Purim 2027"
            className="mt-0.5 block"
          />
        </label>
        <label>
          Copy catalog from
          <Select
            value={form.copyFromSeasonId}
            onChange={(event) => setForm({ ...form, copyFromSeasonId: event.target.value })}
            className="mt-0.5 block"
          >
            <option value="">Start empty</option>
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </Select>
        </label>
        <label>
          Auto-open at (optional)
          <Input
            type="datetime-local"
            value={form.opensAt}
            onChange={(event) => setForm({ ...form, opensAt: event.target.value })}
            className="mt-0.5 block"
          />
        </label>
        <label>
          Auto-close at (optional)
          <Input
            type="datetime-local"
            value={form.closesAt}
            onChange={(event) => setForm({ ...form, closesAt: event.target.value })}
            className="mt-0.5 block"
          />
        </label>
        <Button type="submit" data-testid="create-season">Create season</Button>
      </form>
    </Card>
  );
}
