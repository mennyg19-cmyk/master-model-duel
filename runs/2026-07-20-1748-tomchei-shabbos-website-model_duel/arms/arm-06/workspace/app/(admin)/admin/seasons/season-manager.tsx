"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { SeasonManagerRow } from "@/lib/seasons/queries";

// Server type via `import type` (erased at compile time); the page serializes
// Date → ISO at the boundary.
type SeasonRow = Omit<SeasonManagerRow, "scheduledOpensAt" | "scheduledClosesAt"> & {
  scheduledOpensAt: string | null;
  scheduledClosesAt: string | null;
};

/** datetime-local ⇄ ISO: input shows local time, API stores UTC. */
function toIso(local: string): string | null {
  if (!local) return null;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function SeasonManager({ seasons }: { seasons: SeasonRow[] }) {
  const router = useRouter();
  const [wizardName, setWizardName] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [wizardOpens, setWizardOpens] = useState("");
  const [wizardCloses, setWizardCloses] = useState("");
  const [schedules, setSchedules] = useState<Map<string, { opens: string; closes: string }>>(
    () =>
      new Map(
        seasons.map((s) => [
          s.id,
          { opens: toLocalInput(s.scheduledOpensAt), closes: toLocalInput(s.scheduledClosesAt) },
        ]),
      ),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function call(path: string, body: Record<string, unknown>, key: string, okNote: string, method = "POST") {
    setBusy(key);
    setError(null);
    setNote(null);
    const response = await apiFetch(path, { method, body });
    setBusy(null);
    if (!response.ok) {
      setError(response.body.error ?? "Action failed");
      return false;
    }
    setNote(okNote);
    router.refresh();
    return true;
  }

  async function createSeason() {
    const ok = await call(
      "/api/admin/seasons",
      {
        name: wizardName,
        ...(copyFrom ? { copyCatalogFromSeasonId: copyFrom } : {}),
        ...(toIso(wizardOpens) ? { scheduledOpensAt: toIso(wizardOpens) } : {}),
        ...(toIso(wizardCloses) ? { scheduledClosesAt: toIso(wizardCloses) } : {}),
      },
      "wizard",
      `Season "${wizardName}" created (closed — flip it open when ready).`,
    );
    if (ok) {
      setWizardName("");
      setCopyFrom("");
      setWizardOpens("");
      setWizardCloses("");
    }
  }

  async function flip(season: SeasonRow) {
    const target = season.status === "OPEN" ? "CLOSED" : "OPEN";
    if (
      target === "OPEN" &&
      !window.confirm(`Open "${season.name}"? The currently open season closes in the same move.`)
    ) {
      return;
    }
    await call(
      `/api/admin/seasons/${season.id}`,
      { status: target },
      `flip-${season.id}`,
      target === "OPEN" ? `"${season.name}" is now open.` : `"${season.name}" closed.`,
      "PATCH",
    );
  }

  async function saveSchedule(season: SeasonRow) {
    const schedule = schedules.get(season.id) ?? { opens: "", closes: "" };
    await call(
      `/api/admin/seasons/${season.id}`,
      { scheduledOpensAt: toIso(schedule.opens), scheduledClosesAt: toIso(schedule.closes) },
      `sched-${season.id}`,
      `Schedule saved for "${season.name}" — the season-flip cron picks it up.`,
      "PATCH",
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-6" data-season-manager>
      <Card className="p-5" data-season-wizard>
        <CardTitle>New season wizard</CardTitle>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-sm font-medium text-stone-700">
            Season name
            <Input
              className="mt-1"
              placeholder="Purim 2027"
              value={wizardName}
              onChange={(event) => setWizardName(event.target.value)}
              data-wizard-name
            />
          </label>
          <label className="text-sm font-medium text-stone-700">
            Copy catalog from
            <Select className="mt-1" value={copyFrom} onChange={(event) => setCopyFrom(event.target.value)} data-wizard-copy>
              <option value="">— start empty —</option>
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name} ({season.productCount} products)
                </option>
              ))}
            </Select>
          </label>
          <label className="text-sm font-medium text-stone-700">
            Auto-open at (optional)
            <Input
              type="datetime-local"
              className="mt-1"
              value={wizardOpens}
              onChange={(event) => setWizardOpens(event.target.value)}
              data-wizard-opens
            />
          </label>
          <label className="text-sm font-medium text-stone-700">
            Auto-close at (optional)
            <Input
              type="datetime-local"
              className="mt-1"
              value={wizardCloses}
              onChange={(event) => setWizardCloses(event.target.value)}
              data-wizard-closes
            />
          </label>
        </div>
        <Button className="mt-4" onClick={createSeason} disabled={busy !== null || !wizardName.trim()} data-wizard-create>
          {busy === "wizard" ? "Creating…" : "Create season (closed)"}
        </Button>
      </Card>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
      {note && <p className="rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-900">{note}</p>}

      <ul className="flex flex-col gap-3">
        {seasons.map((season) => {
          const schedule = schedules.get(season.id) ?? { opens: "", closes: "" };
          return (
            <li key={season.id}>
              <Card className="p-5" data-season-row={season.name}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-stone-900">
                      {season.name}{" "}
                      <span
                        className={
                          season.status === "OPEN"
                            ? "rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800"
                            : "rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600"
                        }
                        data-season-status
                      >
                        {season.status}
                      </span>
                    </p>
                    <p className="mt-0.5 text-sm text-stone-500">
                      {season.productCount} products · {season.orderCount} orders
                      {season.scheduledOpensAt ? ` · opens ${new Date(season.scheduledOpensAt).toLocaleString()}` : ""}
                      {season.scheduledClosesAt ? ` · closes ${new Date(season.scheduledClosesAt).toLocaleString()}` : ""}
                    </p>
                  </div>
                  <Button
                    variant={season.status === "OPEN" ? "danger" : "secondary"}
                    size="sm"
                    onClick={() => flip(season)}
                    disabled={busy !== null}
                    data-season-flip
                  >
                    {busy === `flip-${season.id}`
                      ? "Flipping…"
                      : season.status === "OPEN"
                        ? "Close season"
                        : "Open season"}
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-stone-100 pt-3">
                  <label className="text-xs font-medium text-stone-600">
                    Auto-open at
                    <Input
                      type="datetime-local"
                      className="mt-1"
                      value={schedule.opens}
                      onChange={(event) =>
                        setSchedules((prev) =>
                          new Map(prev).set(season.id, { ...schedule, opens: event.target.value }),
                        )
                      }
                      data-schedule-opens
                    />
                  </label>
                  <label className="text-xs font-medium text-stone-600">
                    Auto-close at
                    <Input
                      type="datetime-local"
                      className="mt-1"
                      value={schedule.closes}
                      onChange={(event) =>
                        setSchedules((prev) =>
                          new Map(prev).set(season.id, { ...schedule, closes: event.target.value }),
                        )
                      }
                      data-schedule-closes
                    />
                  </label>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => saveSchedule(season)}
                    disabled={busy !== null}
                    data-schedule-save
                  >
                    {busy === `sched-${season.id}` ? "Saving…" : "Save schedule"}
                  </Button>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
