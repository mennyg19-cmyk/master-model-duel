"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OrderStatus, PaymentStatus } from "@prisma/client";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/order-badges";

export interface OrderListRow {
  id: string;
  label: string;
  customer: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  total: string;
  created: string;
  repeatable: boolean;
  discardable: boolean;
}

interface BulkReport {
  action: string;
  counts: { succeeded: number; skipped: number };
  results: { orderId: string; outcome: string; reason?: string; draftRef?: string }[];
}

// G-024: bulk actions run from the list's selection. The report is per-row
// deterministic — every skip names its reason, every repeat links its draft.
export function OrderListTable({ rows }: { rows: OrderListRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<"repeat" | "discard">("repeat");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<BulkReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string, eligible: boolean) {
    if (!eligible) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function runBulk() {
    setBusy(true);
    setError(null);
    setReport(null);
    const result = await apiFetch<{ report?: BulkReport }>("/api/admin/orders/bulk", {
      method: "POST",
      body: { action, orderIds: [...selected] },
    });
    setBusy(false);
    if (!result.ok || !result.body.report) {
      setError(result.body.error ?? "Bulk action failed");
      return;
    }
    setReport(result.body.report);
    setSelected(new Set());
    router.refresh();
  }

  const eligible = (row: OrderListRow) => (action === "repeat" ? row.repeatable : row.discardable);

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-3" data-bulk-bar>
        <Select value={action} onChange={(event) => setAction(event.target.value as "repeat" | "discard")} data-bulk-action>
          <option value="repeat">Repeat as new drafts</option>
          <option value="discard">Discard drafts</option>
        </Select>
        <Button size="sm" onClick={runBulk} disabled={busy || selected.size === 0} data-bulk-run>
          {busy ? "Running…" : `Apply to ${selected.size} selected`}
        </Button>
        {selected.size > 0 && (
          <button type="button" className="text-sm text-stone-600 hover:underline" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {report && (
        <div className="mt-3 rounded-md border border-stone-200 bg-stone-50 p-3" data-bulk-report>
          <p className="text-sm font-medium text-stone-900">
            {report.action === "repeat" ? "Repeat" : "Discard"}: {report.counts.succeeded} done,{" "}
            {report.counts.skipped} skipped
          </p>
          {report.results.some((entry) => entry.outcome === "skipped") && (
            <ul className="mt-2 flex flex-col gap-1 text-sm text-stone-700">
              {report.results
                .filter((entry) => entry.outcome === "skipped")
                .map((entry, index) => (
                  <li key={`${entry.orderId}-${index}`}>
                    <span className="font-mono text-xs">{entry.orderId}</span> — {entry.reason}
                  </li>
                ))}
            </ul>
          )}
          {report.results.some((entry) => entry.draftRef) && (
            <ul className="mt-2 flex flex-col gap-1 text-sm text-stone-700">
              {report.results
                .filter((entry) => entry.draftRef)
                .map((entry) => (
                  <li key={entry.orderId}>
                    New draft <span className="font-medium">{entry.draftRef}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      <table className="mt-3 w-full border-collapse text-sm" data-order-table>
        <thead>
          <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
            <th className="py-2 pr-2" aria-label="Select" />
            <th className="py-2 pr-4">Order</th>
            <th className="py-2 pr-4">Customer</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">Payment</th>
            <th className="py-2 pr-4 text-right">Total</th>
            <th className="py-2">Placed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-stone-100 hover:bg-stone-50">
              <td className="py-2 pr-2">
                <input
                  type="checkbox"
                  checked={selected.has(row.id)}
                  disabled={!eligible(row)}
                  onChange={() => toggle(row.id, eligible(row))}
                  aria-label={`Select ${row.label}`}
                />
              </td>
              <td className="py-2 pr-4 font-medium">
                <Link href={`/admin/orders/${row.id}`} className="text-brand-700 hover:underline">
                  {row.label}
                </Link>
              </td>
              <td className="py-2 pr-4 text-stone-600">{row.customer}</td>
              <td className="py-2 pr-4">
                <OrderStatusBadge status={row.status} />
              </td>
              <td className="py-2 pr-4">
                <PaymentStatusBadge status={row.paymentStatus} />
              </td>
              <td className="py-2 pr-4 text-right font-medium">{row.total}</td>
              <td className="py-2 text-stone-600">{row.created}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="py-6 text-center text-stone-500">
                No orders match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
