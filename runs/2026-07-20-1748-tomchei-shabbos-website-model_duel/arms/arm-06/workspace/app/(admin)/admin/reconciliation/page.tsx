import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { stripeDriverMode } from "@/lib/payments/stripe";
import { Badge } from "@/components/ui/badge";
import { ReconcileRunButton } from "./run-button";

export const metadata: Metadata = { title: "Stripe reconciliation" };
export const dynamic = "force-dynamic";

const RUN_HISTORY_TAKE = 10;

const KIND_LABEL: Record<string, string> = {
  ORPHANED_INTENT: "Orphaned intent",
  MISSING_PAYMENT: "Missing payment",
  AMOUNT_MISMATCH: "Amount mismatch",
  STALE_MIRROR: "Stale mirror",
  STATUS_DRIFT: "Status drift",
};

// R-093: Stripe payment reconciliation. The matcher flags discrepancies
// between the Stripe-side intent list and the local mirror/payment ledger —
// it never adjusts payments itself, so reruns are safe.
export default async function AdminReconciliationPage() {
  await requirePermission("payments.manage");

  const [latest, runs] = await Promise.all([
    prisma.reconciliationRun.findFirst({
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      include: { findings: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    }),
    prisma.reconciliationRun.findMany({ orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: RUN_HISTORY_TAKE }),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Stripe reconciliation</h1>
      <p className="mt-1 text-sm text-stone-500">
        Compares the Stripe-side payment-intent list with local mirrors and posted payments. Discrepancies are
        flagged for a human — the matcher never adjusts payments itself. Driver mode:{" "}
        <Badge tone="stone" >{stripeDriverMode()}</Badge>
      </p>

      <div className="mt-4">
        <ReconcileRunButton />
      </div>

      {latest && (
        <section className="mt-6" data-reconcile-latest={latest.id}>
          <h2 className="text-lg font-semibold">
            Latest run{" "}
            <span className="text-sm font-normal text-stone-500">
              {latest.startedAt.toISOString().replace("T", " ").slice(0, 19)} · {latest.mode}
            </span>
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3" data-reconcile-counts>
            {[
              ["Checked", latest.checkedCount],
              ["Matched", latest.matchedCount],
              ["Flagged", latest.flaggedCount],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-stone-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
                <p className="mt-1 text-lg font-semibold text-stone-900" data-count={String(label).toLowerCase()}>{value}</p>
              </div>
            ))}
          </div>
          {latest.message && <p className="mt-2 text-xs text-stone-500">{latest.message}</p>}

          <table className="mt-4 w-full border-collapse text-sm" data-reconcile-findings>
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2 pr-4">Kind</th>
                <th className="py-2 pr-4">Intent</th>
                <th className="py-2 pr-4">Detail</th>
              </tr>
            </thead>
            <tbody>
              {latest.findings.map((finding) => (
                <tr key={finding.id} className="border-b border-stone-100" data-finding={finding.kind}>
                  <td className="py-2 pr-4">
                    <Badge tone={finding.kind === "ORPHANED_INTENT" || finding.kind === "MISSING_PAYMENT" ? "amber" : "stone"}>
                      {KIND_LABEL[finding.kind] ?? finding.kind}
                    </Badge>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{finding.intentId ?? "—"}</td>
                  <td className="py-2 pr-4 text-stone-700">{finding.detail}</td>
                </tr>
              ))}
              {latest.findings.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-stone-500">
                    No discrepancies — Stripe and the ledger agree.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Run history</h2>
        <table className="mt-3 w-full border-collapse text-sm" data-reconcile-history>
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="py-2 pr-4">When</th>
              <th className="py-2 pr-4">Mode</th>
              <th className="py-2 pr-4">Actor</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4 text-right">Checked</th>
              <th className="py-2 pr-4 text-right">Flagged</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-b border-stone-100">
                <td className="py-2 pr-4 text-stone-600">{run.startedAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                <td className="py-2 pr-4">{run.mode}</td>
                <td className="py-2 pr-4">{run.actorEmail ?? "cron"}</td>
                <td className="py-2 pr-4">
                  <Badge tone={run.status === "OK" ? "green" : run.status === "FAILED" ? "red" : "amber"}>{run.status}</Badge>
                </td>
                <td className="py-2 pr-4 text-right">{run.checkedCount}</td>
                <td className="py-2 pr-4 text-right">{run.flaggedCount}</td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-stone-500">
                  No reconciliation runs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
