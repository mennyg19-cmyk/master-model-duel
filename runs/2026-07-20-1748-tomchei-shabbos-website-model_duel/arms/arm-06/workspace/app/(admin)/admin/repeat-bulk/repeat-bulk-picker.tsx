"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { formatCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";

interface CandidateRow {
  orderId: string;
  orderNumber: number | null;
  customerId: string;
  customerName: string;
  customerEmail: string;
  seasonName: string;
  lineCount: number;
  totalCents: number;
  placedAt: string;
  alreadyRepeated: boolean;
}

interface RunResult {
  orderId: string;
  outcome: "repeated" | "discarded" | "skipped";
  reason?: string;
  draftRef?: string;
}

export function RepeatBulkPicker({
  rows,
  sourceSeasons,
  selectedSeasonId,
}: {
  rows: CandidateRow[];
  sourceSeasons: { id: string; name: string }[];
  selectedSeasonId: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<RunResult[] | null>(null);

  const eligible = rows.filter((row) => !row.alreadyRepeated);

  function toggle(orderId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  async function run() {
    setBusy(true);
    setError(null);
    setReport(null);
    const result = await apiFetch<{ report?: { results: RunResult[] } }>("/api/admin/repeat-bulk", {
      method: "POST",
      body: { orderIds: [...selected] },
    });
    setBusy(false);
    if (!result.ok || !result.body.report) {
      setError(result.body.error ?? "Bulk repeat failed");
      return;
    }
    setReport(result.body.report.results);
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="mt-4" data-repeat-bulk>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-stone-700">
          Source season
          <Select
            className="ml-2"
            value={selectedSeasonId}
            onChange={(event) => router.push(`/admin/repeat-bulk?seasonId=${event.target.value}`)}
            data-season-picker
          >
            {sourceSeasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </Select>
        </label>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setSelected(new Set(eligible.map((row) => row.orderId)))}
          disabled={eligible.length === 0}
        >
          Select all ({eligible.length})
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
          Clear
        </Button>
        <Button onClick={run} disabled={busy || selected.size === 0} data-run-bulk-repeat>
          {busy ? "Repeating…" : `Repeat ${selected.size} selected`}
        </Button>
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      {report && (
        <Card className="mt-4 p-4" data-bulk-report>
          <h3 className="font-semibold text-stone-900">Last run</h3>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {report.map((result) => (
              <li key={result.orderId} className={result.outcome === "skipped" ? "text-amber-800" : "text-green-800"}>
                {result.outcome === "skipped" ? "Skipped" : `Repeated → ${result.draftRef}`}
                {result.reason ? ` — ${result.reason}` : ""}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <table className="mt-4 w-full border-collapse text-sm" data-candidate-table>
        <thead>
          <tr className="border-b border-stone-200 text-left text-stone-500">
            <th className="py-2 pr-2"></th>
            <th className="py-2 pr-4">Customer</th>
            <th className="py-2 pr-4">Order</th>
            <th className="py-2 pr-4">Items</th>
            <th className="py-2 pr-4">Total</th>
            <th className="py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.orderId} className="border-b border-stone-100" data-candidate-row={row.customerEmail}>
              <td className="py-2 pr-2">
                <input
                  type="checkbox"
                  checked={selected.has(row.orderId)}
                  disabled={row.alreadyRepeated}
                  onChange={() => toggle(row.orderId)}
                  data-select-order
                />
              </td>
              <td className="py-2 pr-4">
                <span className="font-medium text-stone-900">{row.customerName}</span>
                <span className="block text-xs text-stone-500">{row.customerEmail}</span>
              </td>
              <td className="py-2 pr-4">#{row.orderNumber ?? "—"}</td>
              <td className="py-2 pr-4">{row.lineCount}</td>
              <td className="py-2 pr-4">{formatCents(row.totalCents)}</td>
              <td className="py-2">
                {row.alreadyRepeated ? (
                  <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600">
                    already repeated
                  </span>
                ) : (
                  <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                    ready
                  </span>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-stone-500">
                No finalized orders in this season.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
