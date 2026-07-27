"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Legacy migration UI (R-186, G-029): paste the legacy export → dry-run report
// → staged atomic commit. The pipeline is resumable: re-committing the same
// file after an interruption skips the stages that already landed.

type DryRunReport = {
  seasonName: string;
  sourceTotals: { rows: number; orders: number; customers: number; revenueCents: number };
  products: number;
  addresses: number;
  reviewFlags: number;
  mergesIntoExisting: number;
  invalidRows: { line: number; reason: string }[];
  repairs: { line: number; note: string }[];
  merges: { line: number; note: string }[];
};

type CommitOutcome = {
  status: string;
  completedStages: { stage: string; counts: Record<string, number>; skipped: boolean }[];
};

type RunRow = {
  id: string;
  fileName: string;
  status: string;
  createdAt: string;
  stages: { stage: string; finishedAt: string }[];
};

type ReviewItem = { id: string; reason: string; detail: Record<string, unknown> | null };

export function LegacyImportClient({ runs, reviewItems }: { runs: RunRow[]; reviewItems: ReviewItem[] }) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [report, setReport] = useState<DryRunReport | null>(null);
  const [commit, setCommit] = useState<CommitOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function dryRun() {
    setBusy(true); setError(null); setCommit(null);
    const outcome = await apiFetch<{ report: DryRunReport }>("/api/admin/legacy-import", {
      method: "POST",
      body: { csv, fileName: "pasted-legacy.csv" },
    });
    setBusy(false);
    if (!outcome.ok) return setError(outcome.error);
    setReport(outcome.body.report);
    router.refresh();
  }

  async function doCommit() {
    setBusy(true); setError(null);
    const outcome = await apiFetch<CommitOutcome>("/api/admin/legacy-import", {
      method: "PUT",
      body: { csv, fileName: "pasted-legacy.csv" },
    });
    setBusy(false);
    if (!outcome.ok) return setError(outcome.error);
    setCommit(outcome.body);
    router.refresh();
  }

  async function resolveItem(itemId: string) {
    await apiFetch("/api/admin/legacy-import/review", { method: "PATCH", body: { itemId } });
    router.refresh();
  }

  return (
    <div className="max-w-4xl space-y-4">
      <Card>
        <CardTitle className="mb-2">Legacy migration</CardTitle>
        <p className="text-sm text-muted mb-2">
          Paste the legacy system&apos;s order-line export (columns: order_number, order_date,
          customer_name, customer_email, customer_phone, product_name, product_price, quantity,
          recipient_name, address, city, state, zip, method, greeting). Dry-run first — nothing is
          written until you commit, and commits land in staged atomic batches you can resume.
        </p>
        <textarea
          value={csv}
          onChange={(event) => { setCsv(event.target.value); setReport(null); setCommit(null); }}
          rows={8}
          className="w-full rounded-md border border-border bg-white px-3 py-2 font-mono text-xs text-ink"
          data-testid="legacy-csv"
        />
        <div className="mt-2 flex gap-2">
          <Button disabled={busy || !csv.trim()} onClick={dryRun} data-testid="legacy-dry-run">Dry-run</Button>
          {report && (
            <Button variant="secondary" disabled={busy} onClick={doCommit} data-testid="legacy-commit">
              Commit staged import
            </Button>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </Card>

      {report && (
        <Card data-testid="legacy-report">
          <CardTitle className="mb-2">Dry-run report — {report.seasonName}</CardTitle>
          <ul className="text-sm space-y-1">
            <li>{report.sourceTotals.rows} source rows → {report.sourceTotals.orders} orders, {report.sourceTotals.customers} customers, {report.products} products, {report.addresses} address-book entries.</li>
            <li>Source revenue: ${(report.sourceTotals.revenueCents / 100).toFixed(2)}.</li>
            <li>{report.mergesIntoExisting} customers merge into existing records; {report.reviewFlags} addresses will enter the review queue.</li>
          </ul>
          {report.repairs.length > 0 && (
            <div className="mt-2 text-sm">
              <p className="font-medium">Order-number repairs</p>
              <ul className="text-muted">{report.repairs.map((repair) => <li key={repair.line}>Line {repair.line}: {repair.note}</li>)}</ul>
            </div>
          )}
          {report.merges.length > 0 && (
            <div className="mt-2 text-sm">
              <p className="font-medium">Duplicate-customer merges</p>
              <ul className="text-muted">{report.merges.map((merge) => <li key={merge.line}>Line {merge.line}: {merge.note}</li>)}</ul>
            </div>
          )}
          {report.invalidRows.length > 0 && (
            <div className="mt-2 text-sm">
              <p className="font-medium text-danger">Unusable rows (excluded from commit)</p>
              <ul className="text-muted">{report.invalidRows.map((row) => <li key={row.line}>Line {row.line}: {row.reason}</li>)}</ul>
            </div>
          )}
        </Card>
      )}

      {commit && (
        <Card data-testid="legacy-commit-result">
          <CardTitle className="mb-2">Commit — {commit.status}</CardTitle>
          <ul className="text-sm space-y-1">
            {commit.completedStages.map((stage) => (
              <li key={stage.stage}>
                <Badge tone={stage.skipped ? "neutral" : "success"}>{stage.stage}</Badge>{" "}
                {stage.skipped ? "already done — skipped" : JSON.stringify(stage.counts)}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card data-testid="legacy-review-queue">
        <CardTitle className="mb-2">Address review queue ({reviewItems.length} open)</CardTitle>
        {reviewItems.length === 0 ? (
          <p className="text-sm text-muted">Nothing needs review.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {reviewItems.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 border-b border-border/60 pb-2">
                <span>
                  {item.reason}
                  {item.detail ? <span className="text-muted"> — {JSON.stringify(item.detail)}</span> : null}
                </span>
                <Button variant="secondary" onClick={() => resolveItem(item.id)}>Resolve</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle className="mb-2">Migration runs</CardTitle>
        {runs.length === 0 ? (
          <p className="text-sm text-muted">No legacy imports yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {runs.map((run) => (
              <li key={run.id}>
                <Badge tone={run.status === "COMPLETED" ? "success" : run.status === "FAILED" ? "danger" : "neutral"}>
                  {run.status}
                </Badge>{" "}
                {run.fileName} · {new Date(run.createdAt).toLocaleString()} · stages:{" "}
                {run.stages.map((stage) => stage.stage).join(", ") || "none yet"}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
