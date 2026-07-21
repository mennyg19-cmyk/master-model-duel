"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Season = {
  id: string;
  slug: string;
  name: string;
  year: number;
  status: "OPEN" | "CLOSED";
  scheduledOpenAt: string | null;
  scheduledCloseAt: string | null;
};

export function SeasonsAdmin() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [year, setYear] = useState(new Date().getFullYear() + 1);
  const [slug, setSlug] = useState("");
  const [scheduledOpenAt, setScheduledOpenAt] = useState("");

  async function load() {
    const res = await fetch("/api/admin/seasons");
    const json = await res.json();
    if (res.ok) setSeasons(json.seasons);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createSeason(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/admin/seasons", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        year: Number(year),
        slug: slug || undefined,
        scheduledOpenAt: scheduledOpenAt
          ? new Date(scheduledOpenAt).toISOString()
          : null,
      }),
    });
    const json = await res.json();
    setMessage(res.ok ? `Created ${json.season.name}` : json.error || "Create failed");
    if (res.ok) {
      setName("");
      setSlug("");
      setScheduledOpenAt("");
      await load();
    }
  }

  async function setStatus(seasonId: string, status: "OPEN" | "CLOSED") {
    setMessage(null);
    const res = await fetch("/api/admin/season-gate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seasonId, status }),
    });
    const json = await res.json();
    setMessage(res.ok ? `${json.season.name} → ${json.season.status}` : json.error);
    if (res.ok) await load();
  }

  async function scheduleOpen(seasonId: string, localValue: string) {
    setMessage(null);
    const res = await fetch("/api/admin/seasons", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        seasonId,
        scheduledOpenAt: localValue ? new Date(localValue).toISOString() : null,
      }),
    });
    const json = await res.json();
    setMessage(res.ok ? "Schedule saved" : json.error || "Schedule failed");
    if (res.ok) await load();
  }

  return (
    <div className="space-y-6" data-testid="seasons-admin">
      <form
        onSubmit={createSeason}
        className="grid gap-3 rounded bg-white p-4 shadow-sm md:grid-cols-2"
        data-testid="season-wizard"
      >
        <h2 className="md:col-span-2 font-semibold text-[var(--color-forest)]">
          New-season setup wizard
        </h2>
        <p className="md:col-span-2 text-sm opacity-70">
          Creates a CLOSED season. Open it manually or schedule an auto-flip. Archive seasons stay
          browsable when closed.
        </p>
        <label className="text-sm">
          Name
          <input
            className="mt-1 w-full rounded border px-2 py-1.5"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            data-testid="season-name"
          />
        </label>
        <label className="text-sm">
          Year
          <input
            type="number"
            className="mt-1 w-full rounded border px-2 py-1.5"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            required
            data-testid="season-year"
          />
        </label>
        <label className="text-sm">
          Slug (optional)
          <input
            className="mt-1 w-full rounded border px-2 py-1.5"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            data-testid="season-slug"
          />
        </label>
        <label className="text-sm">
          Scheduled open (optional)
          <input
            type="datetime-local"
            className="mt-1 w-full rounded border px-2 py-1.5"
            value={scheduledOpenAt}
            onChange={(e) => setScheduledOpenAt(e.target.value)}
            data-testid="season-scheduled-open"
          />
        </label>
        <div className="md:col-span-2">
          <Button type="submit" data-testid="season-create">
            Create season
          </Button>
        </div>
      </form>

      <ul className="space-y-3" data-testid="season-list">
        {seasons.map((s) => (
          <li key={s.id} className="rounded bg-white p-4 shadow-sm" data-testid={`season-${s.slug}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">
                  {s.name} ({s.year}) · {s.status}
                </p>
                <p className="text-xs opacity-60">
                  {s.slug}
                  {s.scheduledOpenAt
                    ? ` · auto-open ${new Date(s.scheduledOpenAt).toLocaleString()}`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setStatus(s.id, "OPEN")}
                  data-testid={`season-open-${s.slug}`}
                >
                  Open
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setStatus(s.id, "CLOSED")}
                  data-testid={`season-close-${s.slug}`}
                >
                  Close
                </Button>
              </div>
            </div>
            <label className="mt-3 block text-sm">
              Schedule auto-open
              <input
                type="datetime-local"
                className="mt-1 block rounded border px-2 py-1.5"
                data-testid={`season-schedule-${s.slug}`}
                onChange={(e) => void scheduleOpen(s.id, e.target.value)}
              />
            </label>
          </li>
        ))}
      </ul>
      {message ? <p className="text-sm" data-testid="seasons-message">{message}</p> : null}
    </div>
  );
}
