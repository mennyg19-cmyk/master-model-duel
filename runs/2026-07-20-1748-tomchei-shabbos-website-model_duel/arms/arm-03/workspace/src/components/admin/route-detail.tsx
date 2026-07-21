"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

export function RouteDetailClient() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [route, setRoute] = useState<Record<string, unknown> | null>(null);
  const [magicUrl, setMagicUrl] = useState<string | null>(null);
  const [printText, setPrintText] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<unknown[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/routes/${id}`);
    const json = await res.json();
    if (res.ok) setRoute(json.route);
    else setError(json.error || "Load failed");
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/admin/routes/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(typeof json.error === "string" ? json.error : "Action failed");
      return json;
    }
    if (body.action === "magic-link") setMagicUrl(json.url);
    if (body.action === "print") setPrintText(json.printText);
    if (body.action === "suggest-reroute") setSuggestions(json.suggestions || []);
    await load();
    return json;
  }

  if (!route) {
    return <p className="text-sm">{error || "Loading…"}</p>;
  }

  const stops = (route.stops as Array<Record<string, unknown>>) || [];

  return (
    <div className="space-y-4">
      <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
        {String(route.name)}
      </h1>
      <p className="text-sm opacity-70">{String(route.status)}</p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded bg-[var(--color-forest)] px-3 py-2 text-sm text-white"
          onClick={() => void act({ action: "magic-link" })}
        >
          Issue magic link
        </button>
        <button
          type="button"
          className="rounded border px-3 py-2 text-sm"
          onClick={() => void act({ action: "print" })}
        >
          Print fallback
        </button>
        <button
          type="button"
          className="rounded border px-3 py-2 text-sm"
          onClick={() => void act({ action: "suggest-reroute" })}
        >
          Nearby ship packages
        </button>
      </div>

      {magicUrl ? (
        <p className="break-all text-sm">
          Magic: <a href={magicUrl}>{magicUrl}</a>
        </p>
      ) : null}
      {printText ? (
        <pre className="overflow-auto rounded bg-white p-3 text-xs shadow-sm">{printText}</pre>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <ul className="space-y-2">
        {stops.map((stop) => (
          <li key={String(stop.id)} className="rounded bg-white p-3 text-sm shadow-sm">
            {String(stop.sequence)}. {String(stop.recipientName)} — {String(stop.addressLine1)}
          </li>
        ))}
      </ul>

      {suggestions.length > 0 ? (
        <section>
          <h2 className="font-semibold">Reroute suggestions (confirm required)</h2>
          <ul className="mt-2 space-y-2">
            {suggestions.map((s) => {
              const row = s as { packageId: string; reason: string; miles: number | null };
              return (
                <li key={row.packageId} className="flex items-center gap-2 text-sm">
                  <span>
                    {row.packageId.slice(0, 8)}… ({row.reason}
                    {row.miles != null ? ` ${row.miles.toFixed(2)}mi` : ""})
                  </span>
                  <button
                    type="button"
                    className="rounded border px-2 py-1"
                    onClick={() =>
                      void act({
                        action: "confirm-reroute",
                        packageId: row.packageId,
                        confirm: true,
                      })
                    }
                  >
                    Confirm
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
