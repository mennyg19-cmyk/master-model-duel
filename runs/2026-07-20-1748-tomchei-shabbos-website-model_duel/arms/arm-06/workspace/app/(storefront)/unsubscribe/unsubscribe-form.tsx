"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";

interface Prefs {
  prefNewProducts: boolean;
  prefReminders: boolean;
  prefCommunity: boolean;
}

const PREF_LABELS: { key: keyof Prefs; label: string; description: string }[] = [
  {
    key: "prefNewProducts",
    label: "New packages",
    description: "Catalog announcements when new packages go live.",
  },
  {
    key: "prefReminders",
    label: "Ordering reminders",
    description: "Deadlines and season open/close notices.",
  },
  {
    key: "prefCommunity",
    label: "Community updates",
    description: "News from Tomchei Shabbos beyond ordering.",
  },
];

// R-018: three independent preference states plus a full unsubscribe, all
// posted with the HMAC token.
export function UnsubscribeForm({
  token,
  initialPrefs,
  initialUnsubscribed,
}: {
  token: string;
  initialPrefs: Prefs;
  initialUnsubscribed: boolean;
}) {
  const [prefs, setPrefs] = useState<Prefs>(initialPrefs);
  const [isUnsubscribed, setIsUnsubscribed] = useState(initialUnsubscribed);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save(next: { unsubscribeAll: boolean; prefs: Prefs }) {
    setStatus("saving");
    const { ok, body } = await apiFetch<{ unsubscribed?: boolean; prefs?: Prefs }>("/api/unsubscribe", {
      method: "POST",
      body: { token, unsubscribeAll: next.unsubscribeAll, prefs: next.prefs },
    });
    if (!ok) {
      setStatus("error");
      return;
    }
    setIsUnsubscribed(Boolean(body.unsubscribed));
    if (body.prefs) setPrefs(body.prefs);
    setStatus("saved");
  }

  function toggle(key: keyof Prefs) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    save({ unsubscribeAll: isUnsubscribed, prefs: next });
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <ul className="flex flex-col gap-3">
        {PREF_LABELS.map((pref) => (
          <li key={pref.key} className="flex items-start gap-3 rounded-lg border border-stone-200 bg-white p-4">
            <input
              id={pref.key}
              type="checkbox"
              checked={prefs[pref.key]}
              disabled={isUnsubscribed || status === "saving"}
              onChange={() => toggle(pref.key)}
              className="mt-1 h-4 w-4 accent-brand-700"
            />
            <label htmlFor={pref.key} className="text-sm">
              <span className="font-medium text-stone-900">{pref.label}</span>
              <span className="block text-stone-600">{pref.description}</span>
            </label>
          </li>
        ))}
      </ul>

      {isUnsubscribed ? (
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
          <p className="text-sm text-stone-700">You&apos;re unsubscribed from all emails.</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            disabled={status === "saving"}
            onClick={() => save({ unsubscribeAll: false, prefs })}
          >
            Resubscribe
          </Button>
        </div>
      ) : (
        <Button
          variant="danger"
          className="self-start"
          disabled={status === "saving"}
          onClick={() => save({ unsubscribeAll: true, prefs })}
        >
          Unsubscribe from all emails
        </Button>
      )}

      {status === "saved" && <p className="text-sm text-green-700">Preferences saved.</p>}
      {status === "error" && (
        <p className="text-sm text-red-600">Could not save — that link may have expired.</p>
      )}
    </div>
  );
}
