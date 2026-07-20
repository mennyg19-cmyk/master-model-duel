"use client";

import { useEffect, useState } from "react";

type Preferences = {
  email: string;
  productUpdates: boolean;
  volunteerStories: boolean;
  communityImpact: boolean;
  isSubscribed: boolean;
};

export function NewsletterPreferences({ token }: { token: string }) {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [message, setMessage] = useState("Loading your preferences…");

  useEffect(() => {
    fetch(`/api/newsletter/preferences?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        setPreferences(payload);
        setMessage("");
      })
      .catch((error: Error) => setMessage(error.message));
  }, [token]);

  async function savePreferences(nextPreferences: Preferences) {
    const response = await fetch("/api/newsletter/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, ...nextPreferences }),
    });
    const payload = await response.json();
    setMessage(payload.error ?? payload.message);
    if (response.ok) setPreferences(nextPreferences);
  }

  if (!preferences) {
    return <p className="text-[var(--muted)]">{message}</p>;
  }

  return (
    <div>
      <p className="text-sm text-[var(--muted)]">{preferences.email}</p>
      <div className="mt-6 space-y-3">
        {[
          ["productUpdates", "New Purim gifts and ordering dates"],
          ["volunteerStories", "Volunteer stories"],
          ["communityImpact", "Community impact updates"],
        ].map(([key, label]) => (
          <label className="flex items-center gap-3 rounded-2xl border border-[var(--border)] p-4" key={key}>
            <input
              checked={preferences[key as keyof Preferences] as boolean}
              onChange={(event) =>
                setPreferences({ ...preferences, [key]: event.target.checked })
              }
              type="checkbox"
            />
            <span className="font-semibold">{label}</span>
          </label>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          className="rounded-full bg-[var(--brand)] px-6 py-3 font-bold text-white"
          onClick={() => savePreferences({ ...preferences, isSubscribed: true })}
          type="button"
        >
          Save preferences
        </button>
        <button
          className="rounded-full border border-[var(--border)] px-6 py-3 font-bold"
          onClick={() => savePreferences({ ...preferences, isSubscribed: false })}
          type="button"
        >
          Unsubscribe from all
        </button>
      </div>
      {message && <p aria-live="polite" className="mt-4 text-sm font-semibold">{message}</p>}
    </div>
  );
}
