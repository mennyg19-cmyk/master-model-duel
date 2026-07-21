"use client";

import { useState } from "react";

export function NewsletterForm({
  initialEmail = "",
  compact = false,
}: {
  initialEmail?: string;
  compact?: boolean;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [seasons, setSeasons] = useState(true);
  const [updates, setUpdates] = useState(true);
  const [promotions, setPromotions] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, preferences: { seasons, updates, promotions } }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error || "Could not subscribe.");
        return;
      }
      setMessage(`Subscribed as ${json.email}. Check your email for manage/unsubscribe links.`);
    } catch {
      setMessage("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={compact ? "flex w-full max-w-md flex-col gap-2 sm:flex-row" : "space-y-3"} data-testid="newsletter-form">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        className="flex-1 rounded-[var(--radius-md)] border border-[var(--color-forest)]/20 px-3 py-2 text-sm"
        name="email"
      />
      {!compact ? (
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={seasons} onChange={(e) => setSeasons(e.target.checked)} />
            Season openings
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={updates} onChange={(e) => setUpdates(e.target.checked)} />
            Community updates
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={promotions} onChange={(e) => setPromotions(e.target.checked)} />
            Promotions
          </label>
        </div>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="rounded-[var(--radius-md)] bg-[var(--color-forest)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Saving…" : "Sign up"}
      </button>
      {message ? <p className="w-full text-sm" data-testid="newsletter-message">{message}</p> : null}
    </form>
  );
}
