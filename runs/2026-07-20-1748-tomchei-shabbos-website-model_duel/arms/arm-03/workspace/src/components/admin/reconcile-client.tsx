"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Run = {
  id: string;
  status: string;
  triggeredBy: string;
  orphanedCount: number;
  matchedCount: number;
  adjustedCount: number;
  startedAt: string;
  adjustments: Array<{ kind: string; stripePaymentIntentId: string | null }>;
};

export function ReconcileClient() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/reconcile");
    const json = await res.json();
    if (res.ok) setRuns(json.runs ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function run() {
    setMessage(null);
    const res = await fetch("/api/admin/reconcile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "run" }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error || "Reconcile failed");
      return;
    }
    setMessage(
      `Run ${json.runId?.slice(0, 8)} · orphans=${json.orphanedCount} matched=${json.matchedCount} adjusted=${json.adjustedCount} skippedDup=${json.skippedDuplicates}`,
    );
    await load();
  }

  return (
    <div className="space-y-4" data-testid="reconcile-hub">
      <Button type="button" onClick={() => void run()} data-testid="reconcile-run">
        Run Stripe reconciliation
      </Button>
      {message ? (
        <p className="text-sm" data-testid="reconcile-message">
          {message}
        </p>
      ) : null}
      <ul className="space-y-2" data-testid="reconcile-runs">
        {runs.map((r) => (
          <li key={r.id} className="rounded bg-white p-3 text-xs shadow-sm">
            {r.status} · {r.triggeredBy} · orphans {r.orphanedCount} / adj {r.adjustedCount} ·{" "}
            {new Date(r.startedAt).toLocaleString()}
          </li>
        ))}
      </ul>
    </div>
  );
}
