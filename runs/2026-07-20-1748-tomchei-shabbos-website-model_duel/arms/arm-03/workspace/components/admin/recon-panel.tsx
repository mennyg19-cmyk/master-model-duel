"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api-client";
import { useHubAct } from "@/components/admin/use-hub-act";

type Flag = {
  id: string;
  kind: string;
  reference: string;
  status: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

type Summary = { findings: number; newFlags: number; openFlags: number; byKind: Record<string, number> };

/** Stripe reconciliation run button + open-flag queue (R-093). */
export function ReconPanel({ flags }: { flags: Flag[] }) {
  const { message, busy, act } = useHubAct();
  const [summary, setSummary] = useState<Summary | null>(null);

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <Button
          data-testid="recon-run"
          disabled={busy}
          onClick={() =>
            act(async () => {
              const result = await apiFetch<{ summary: Summary }>("/api/admin/reconciliation", { method: "POST", body: {} });
              if (result.ok) setSummary(result.body.summary);
              return result;
            }, "Reconciliation finished.")
          }
        >
          {busy ? "Running…" : "Run reconciliation now"}
        </Button>
        {summary && (
          <span className="text-sm text-muted" data-testid="recon-summary">
            {summary.findings} finding{summary.findings === 1 ? "" : "s"}, {summary.newFlags} new, {summary.openFlags} open
          </span>
        )}
      </div>
      {message && <p className="text-sm mb-3">{message}</p>}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-border">
            <th className="py-1 pr-2">Kind</th>
            <th className="py-1 pr-2">Reference</th>
            <th className="py-1 pr-2">Detail</th>
            <th className="py-1 pr-2">Status</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {flags.length === 0 && (
            <tr><td colSpan={5} className="py-2 text-muted">No reconciliation flags. Run the matcher to check.</td></tr>
          )}
          {flags.map((flag) => (
            <tr key={flag.id} className="border-b border-border/60" data-testid="recon-flag">
              <td className="py-1 pr-2 font-medium">{flag.kind}</td>
              <td className="py-1 pr-2 font-mono text-xs">{flag.reference}</td>
              <td className="py-1 pr-2 text-xs text-muted max-w-md truncate">{JSON.stringify(flag.detail)}</td>
              <td className="py-1 pr-2"><Badge tone={flag.status === "open" ? "danger" : "neutral"}>{flag.status}</Badge></td>
              <td className="py-1">
                {flag.status === "open" && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      act(
                        () => apiFetch("/api/admin/reconciliation", { method: "PATCH", body: { flagId: flag.id } }),
                        "Flag resolved."
                      )
                    }
                  >
                    Resolve
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
