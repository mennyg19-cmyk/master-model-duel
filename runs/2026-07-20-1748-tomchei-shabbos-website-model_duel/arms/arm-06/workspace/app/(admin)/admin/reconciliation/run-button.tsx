"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";

// R-093: the run button — one POST kicks a reconciliation pass; the page
// re-renders with the fresh run + findings.
export function ReconcileRunButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const result = await apiFetch("/api/admin/reconciliation/run", { method: "POST" });
    setBusy(false);
    if (!result.ok) {
      setError(result.body.error ?? "Reconciliation run failed");
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" onClick={run} disabled={busy} data-reconcile-run>
        {busy ? "Running…" : "Run reconciliation"}
      </Button>
      {error && <span className="text-sm text-red-700">{error}</span>}
    </span>
  );
}
