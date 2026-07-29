"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";

// R-101: the four console actions as explicit, confirm-gated buttons.
const ACTIONS = [
  {
    key: "seed",
    label: "Seed baseline",
    description: "Idempotent baseline: 2026 season, catalog, settings, demo customer. Safe to re-run.",
    confirm: null,
  },
  {
    key: "clear",
    label: "Clear transactional data",
    description: "Deletes orders, packages, payments, shipments, routes, imports, reconciliation runs. Keeps the season, catalog, customers, and settings.",
    confirm: "Clear ALL transactional data? The season and catalog survive; the order trail does not.",
  },
  {
    key: "wipe",
    label: "Wipe everything",
    description: "Deletes ALL domain data including seasons, catalog, customers, and settings. Staff accounts and the audit log survive.",
    confirm: "Wipe the entire database (except staff + audit)? There is no undo.",
  },
  {
    key: "reset",
    label: "Wipe + reseed",
    description: "Full wipe, then the baseline seed — a clean test season in one step.",
    confirm: "Wipe everything and reseed the baseline? There is no undo.",
  },
] as const;

type ActionKey = (typeof ACTIONS)[number]["key"];

export function TestOpsConsole() {
  const router = useRouter();
  const [busy, setBusy] = useState<ActionKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  async function run(action: (typeof ACTIONS)[number]) {
    if (action.confirm && !window.confirm(action.confirm)) return;
    setBusy(action.key);
    setError(null);
    setLastResult(null);
    const result = await apiFetch<{ counts?: Record<string, number> }>("/api/admin/test-ops", {
      method: "POST",
      body: { action: action.key },
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.body.error ?? `Could not run ${action.label}`);
      return;
    }
    const counts = result.body.counts ? ` — ${JSON.stringify(result.body.counts)}` : "";
    setLastResult(`${action.label} done${counts}`);
    router.refresh();
  }

  return (
    <div className="mt-5 grid gap-4 md:grid-cols-2" data-testops-console>
      {ACTIONS.map((action) => (
        <div key={action.key} className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="font-semibold">{action.label}</h2>
          <p className="mt-1 text-sm text-stone-600">{action.description}</p>
          <Button
            type="button"
            className="mt-3"
            variant={action.confirm ? "danger" : "primary"}
            disabled={busy !== null}
            onClick={() => run(action)}
            data-testops-action={action.key}
          >
            {busy === action.key ? "Running…" : action.label}
          </Button>
        </div>
      ))}
      {error && <p className="text-sm text-red-700 md:col-span-2">{error}</p>}
      {lastResult && <p className="text-sm text-green-800 md:col-span-2" data-testops-result>{lastResult}</p>}
    </div>
  );
}
