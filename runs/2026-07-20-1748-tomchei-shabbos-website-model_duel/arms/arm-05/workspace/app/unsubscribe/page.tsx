"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function UnsubscribeFlow() {
  const searchParams = useSearchParams();
  const [statusMessage, setStatusMessage] = useState("");
  const [preferences, setPreferences] = useState({ marketing: true, updates: true, reminders: true });
  const token = searchParams.get("token");

  useEffect(() => {
    if (!token) return;
    void fetch(`/api/newsletter?token=${encodeURIComponent(token)}`)
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (ok) setPreferences(body.preferences);
        else setStatusMessage(body.error);
      });
  }, [token]);

  async function unsubscribe() {
    const response = await fetch("/api/newsletter", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = await response.json();
    setStatusMessage(response.ok ? body.message : body.error);
  }

  async function savePreferences() {
    const response = await fetch("/api/newsletter", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, preferences }),
    });
    const body = await response.json();
    setStatusMessage(response.ok ? body.message : body.error);
  }

  return (
    <main>
      <p className="eyebrow">Email preferences</p>
      <h1>Unsubscribe from updates</h1>
      <p className="lead">Choose the updates you want, or unsubscribe entirely.</p>
      <fieldset disabled={!token}>
        <legend>Send me</legend>
        {(["marketing", "updates", "reminders"] as const).map((preference) => (
          <label key={preference}>
            <input
              checked={preferences[preference]}
              onChange={(event) => setPreferences({ ...preferences, [preference]: event.target.checked })}
              type="checkbox"
            />
            {preference[0].toUpperCase() + preference.slice(1)}
          </label>
        ))}
      </fieldset>
      <button className="button secondary" disabled={!token} onClick={() => void savePreferences()}>Save preferences</button>
      <button className="button" disabled={!token} onClick={() => void unsubscribe()}>Unsubscribe</button>
      {statusMessage && <p role="status">{statusMessage}</p>}
    </main>
  );
}

export default function UnsubscribePage() {
  return <Suspense fallback={<main><p>Loading email preferences…</p></main>}><UnsubscribeFlow /></Suspense>;
}
