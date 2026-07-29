"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface PreviewRow {
  row: number;
  verdict: "valid" | "duplicate" | "invalid";
  reason: string | null;
  data: Record<string, string | null>;
}

const VERDICT_TONES = { valid: "green", duplicate: "amber", invalid: "red" } as const;

// R-143: per-row verdicts before commit. Commit writes only the valid rows
// (atomically, server-side); discard abandons the batch. Both decisions are
// audited.
export function ImportPreview({
  batchId,
  status,
  dryRun,
  counts,
  rows,
}: {
  batchId: string;
  status: "STAGED" | "COMMITTED" | "DISCARDED";
  dryRun: boolean;
  counts: { total: number; valid: number; duplicate: number; invalid: number; committed: number };
  rows: PreviewRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "commit" | "discard") {
    if (action === "discard" && !window.confirm("Discard this staged import? Nothing has been written.")) return;
    setBusy(action);
    setError(null);
    const result = await apiFetch(`/api/admin/imports/${batchId}/${action}`, { method: "POST", body: {} });
    setBusy(null);
    if (!result.ok) {
      setError(result.body.error ?? `Could not ${action}`);
      return;
    }
    router.refresh();
  }

  const columns = [...new Set(rows.flatMap((row) => Object.keys(row.data)))];

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-3" data-import-summary>
        <Badge tone="stone">{counts.total} rows</Badge>
        <Badge tone="green">{counts.valid} valid</Badge>
        <Badge tone="amber">{counts.duplicate} duplicates</Badge>
        <Badge tone="red">{counts.invalid} invalid</Badge>
        {status === "COMMITTED" && <Badge tone="brand">{counts.committed} committed</Badge>}
        {status === "STAGED" && dryRun && (
          <>
            <Badge tone="amber">DRY RUN — nothing will write</Badge>
            <Button variant="secondary" size="sm" onClick={() => decide("discard")} disabled={busy !== null} data-import-discard>
              {busy === "discard" ? "Discarding…" : "Discard batch"}
            </Button>
          </>
        )}
        {status === "STAGED" && !dryRun && (
          <>
            <Button size="sm" onClick={() => decide("commit")} disabled={busy !== null || counts.valid === 0} data-import-commit>
              {busy === "commit" ? "Committing…" : `Commit ${counts.valid} row${counts.valid === 1 ? "" : "s"}`}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => decide("discard")} disabled={busy !== null} data-import-discard>
              {busy === "discard" ? "Discarding…" : "Discard batch"}
            </Button>
          </>
        )}
        {status !== "STAGED" && <Badge tone={status === "COMMITTED" ? "green" : "stone"}>{status}</Badge>}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {status === "STAGED" && counts.valid === 0 && (
        <p className="mt-2 text-sm text-amber-800">No valid rows to commit — discard or stage a corrected file.</p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm" data-import-rows>
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="py-2 pr-3">Row</th>
              <th className="py-2 pr-3">Verdict</th>
              {columns.map((column) => (
                <th key={column} className="py-2 pr-3">
                  {column}
                </th>
              ))}
              <th className="py-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.row} className="border-b border-stone-100" data-import-row={row.row}>
                <td className="py-1.5 pr-3 text-stone-500">{row.row}</td>
                <td className="py-1.5 pr-3">
                  <Badge tone={VERDICT_TONES[row.verdict]}>{row.verdict}</Badge>
                </td>
                {columns.map((column) => (
                  <td key={column} className="py-1.5 pr-3 text-stone-700">
                    {row.data[column] ?? "—"}
                  </td>
                ))}
                <td className="py-1.5 text-xs text-stone-500">{row.reason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
