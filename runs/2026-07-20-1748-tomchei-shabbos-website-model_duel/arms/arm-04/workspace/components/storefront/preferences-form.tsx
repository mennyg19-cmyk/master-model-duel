"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function PreferencesForm({
  token,
  initial,
}: {
  token: string;
  initial: { wantsSeasonOpening: boolean; wantsPurimReminders: boolean; unsubscribed: boolean };
}) {
  const [wantsSeasonOpening, setWantsSeasonOpening] = useState(initial.wantsSeasonOpening);
  const [wantsPurimReminders, setWantsPurimReminders] = useState(initial.wantsPurimReminders);
  const [unsubscribed, setUnsubscribed] = useState(initial.unsubscribed);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setMessage(null);
    const response = await fetch("/api/newsletter/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, wantsSeasonOpening, wantsPurimReminders }),
    });
    const body = await response.json();
    setMessage(response.ok ? "Preferences saved." : body.error ?? "Save failed.");
  }

  async function unsubscribe() {
    setMessage(null);
    const response = await fetch("/api/newsletter/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = await response.json();
    if (response.ok) {
      setUnsubscribed(true);
      setMessage("You are unsubscribed. We won't email you again.");
    } else {
      setMessage(body.error ?? "Unsubscribe failed.");
    }
  }

  if (unsubscribed) {
    return (
      <div>
        <p className="text-sm text-muted">
          This address is unsubscribed. Re-subscribe any time from the signup form in the footer.
        </p>
        {message && <p className="mt-2 text-sm font-medium text-success">{message}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={wantsSeasonOpening}
          onChange={(event) => setWantsSeasonOpening(event.target.checked)}
          className="accent-brand"
        />
        Email me when a new season&apos;s store opens
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={wantsPurimReminders}
          onChange={(event) => setWantsPurimReminders(event.target.checked)}
          className="accent-brand"
        />
        Send me Purim deadline reminders
      </label>
      <div className="flex gap-3">
        <Button onClick={save}>Save preferences</Button>
        <Button variant="secondary" onClick={unsubscribe}>
          Unsubscribe from everything
        </Button>
      </div>
      {message && <p className="text-sm font-medium">{message}</p>}
    </div>
  );
}
