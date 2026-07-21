"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function PreferencesInner() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [seasons, setSeasons] = useState(true);
  const [updates, setUpdates] = useState(true);
  const [promotions, setPromotions] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) setMessage("Missing preferences token.");
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/newsletter/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          preferences: { seasons, updates, promotions },
        }),
      });
      const json = await res.json();
      setMessage(res.ok ? "Preferences saved." : json.error || "Could not save.");
    } catch {
      setMessage("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-center font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
        Email preferences
      </h1>
      <form onSubmit={onSubmit} className="mt-8 space-y-4" data-testid="newsletter-preferences-form">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={seasons}
            onChange={(e) => setSeasons(e.target.checked)}
            data-testid="pref-seasons"
          />
          Season openings
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={updates}
            onChange={(e) => setUpdates(e.target.checked)}
            data-testid="pref-updates"
          />
          Community updates
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={promotions}
            onChange={(e) => setPromotions(e.target.checked)}
            data-testid="pref-promotions"
          />
          Promotions
        </label>
        <button
          type="submit"
          disabled={busy || !token}
          className="rounded-[var(--radius-md)] bg-[var(--color-forest)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save preferences"}
        </button>
      </form>
      {message ? (
        <p className="mt-4 text-center text-sm" data-testid="preferences-result">
          {message}
        </p>
      ) : null}
    </main>
  );
}

export default function PreferencesPage() {
  return (
    <Suspense fallback={<main className="p-8 text-center text-sm">Loading…</main>}>
      <PreferencesInner />
    </Suspense>
  );
}
