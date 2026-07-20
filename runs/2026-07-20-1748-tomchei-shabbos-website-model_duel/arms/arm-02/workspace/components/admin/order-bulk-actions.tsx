"use client";

import { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

// Bulk order actions with deterministic conflict reporting (G-024): the API
// processes sorted ids one guarded transaction each and reports done/skipped;
// this bar renders that report verbatim so two racing staff members both see
// exactly which orders the other one won.

type BulkContextValue = { selected: Set<string>; toggle: (id: string) => void };
const BulkContext = createContext<BulkContextValue | null>(null);

export function BulkCheckbox({ id }: { id: string }) {
  const context = useContext(BulkContext);
  if (!context) return null;
  return (
    <input
      type="checkbox"
      aria-label="Select order"
      checked={context.selected.has(id)}
      onChange={() => context.toggle(id)}
    />
  );
}

type BulkReport = {
  action: string;
  done: string[];
  skipped: { id: string; reason: string }[];
} | null;

export function OrderBulkActions({
  enabled,
  orders,
  children,
}: {
  enabled: boolean;
  orders: { id: string; status: string; label: string }[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<BulkReport>(null);
  const [busy, setBusy] = useState(false);
  const labelById = new Map(orders.map((order) => [order.id, order.label]));

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = orders.length > 0 && orders.every((order) => selected.has(order.id));
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(orders.map((order) => order.id)));
  };

  async function runBulk(action: "finalize" | "discard") {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    setReport(null);
    try {
      const result = await apiFetch<{ done: string[]; skipped: { id: string; reason: string }[] }>(
        "/api/admin/orders/bulk",
        { method: "POST", body: { action, ids: [...selected] } }
      );
      if (!result.ok) {
        setReport({ action, done: [], skipped: [{ id: "request", reason: result.error }] });
        return;
      }
      setReport({ action, done: result.body.done, skipped: result.body.skipped });
      setSelected(new Set());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <BulkContext.Provider value={{ selected, toggle }}>
      {enabled && (
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className="text-muted">{selected.size} selected</span>
          <button
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() => runBulk("finalize")}
            className="rounded-md border border-border px-3 py-1 hover:bg-brand-soft disabled:opacity-50"
          >
            Finalize selected
          </button>
          <button
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() => runBulk("discard")}
            className="rounded-md border border-border px-3 py-1 text-danger hover:bg-red-50 disabled:opacity-50"
          >
            Discard selected
          </button>
        </div>
      )}
      {report && (
        <div className="mb-3 rounded-md border border-border bg-brand-soft/40 p-3 text-sm" data-testid="bulk-report">
          <p className="font-medium">
            Bulk {report.action}: {report.done.length} done, {report.skipped.length} skipped.
          </p>
          {report.skipped.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-muted">
              {report.skipped.map((entry) => (
                <li key={entry.id}>
                  {labelById.get(entry.id) ?? entry.id}: {entry.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="w-8 py-2 pr-2">
              {enabled && (
                <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={toggleAll} />
              )}
            </th>
            <th className="py-2 pr-3">Order</th>
            <th className="py-2 pr-3">Customer</th>
            <th className="py-2 pr-3">Placed</th>
            <th className="py-2 pr-3">Lines</th>
            <th className="py-2 pr-3">Total</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2">Payment</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </BulkContext.Provider>
  );
}
