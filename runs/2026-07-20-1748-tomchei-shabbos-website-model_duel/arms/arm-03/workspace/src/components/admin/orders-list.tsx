"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type OrderRow = {
  id: string;
  orderNumber: number | null;
  draftRef: string;
  status: string;
  paymentStatusCached: string;
  expectedTotalCents: number | null;
  version: number;
  customer: { displayName: string; email: string | null } | null;
  season: { name: string; year: number };
  _count: { lines: number; packages: number };
};

export function OrdersListClient() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (paymentStatus) params.set("paymentStatus", paymentStatus);
    const res = await fetch(`/api/admin/orders?${params}`);
    const json = await res.json();
    if (res.ok) {
      setOrders(json.orders);
      setTotalPages(json.totalPages);
      setTotal(json.total);
    }
    setLoading(false);
  }, [page, paymentStatus, q, status]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(order: OrderRow) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[order.id] != null) delete next[order.id];
      else next[order.id] = order.version;
      return next;
    });
  }

  async function runBulk(action: "repeat" | "status") {
    setMessage(null);
    const items = Object.entries(selected).map(([orderId, expectedVersion]) => ({
      orderId,
      expectedVersion,
    }));
    if (!items.length) {
      setMessage("Select at least one order.");
      return;
    }
    if (action === "repeat") {
      const confirmed = window.confirm(
        `Repeat ${items.length} order(s) into the open season?\n\nConfirm: use price-smart replacement defaults and keep each line's recipient.`,
      );
      if (!confirmed) return;
    }
    const res = await fetch("/api/admin/orders/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        action === "repeat"
          ? {
              action: "repeat",
              items,
              confirmReplacements: true,
              confirmRecipients: true,
            }
          : { action: "status", toStatus: "FULFILLING", items },
      ),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error || "Bulk failed");
      return;
    }
    setMessage(
      `Bulk ${action}: created/updated=${(json.created?.length ?? json.updated?.length) ?? 0}, conflicts=${json.conflicts?.length ?? 0}, skipped=${json.skipped?.length ?? 0}`,
    );
    setSelected({});
    await load();
  }

  return (
    <div className="space-y-4" data-testid="orders-list">
      <form
        className="flex flex-wrap gap-2 rounded bg-white p-4 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          void load();
        }}
      >
        <input
          className="min-w-[12rem] flex-1 rounded border px-3 py-2 text-sm"
          placeholder="Search #, name, email, draftRef…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="orders-search"
        />
        <select
          className="rounded border px-2 py-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          data-testid="orders-status-filter"
        >
          <option value="">All statuses</option>
          {["PLACED", "PAID", "FULFILLING", "COMPLETED", "CANCELLED", "DRAFT"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="rounded border px-2 py-2 text-sm"
          value={paymentStatus}
          onChange={(e) => setPaymentStatus(e.target.value)}
        >
          <option value="">All payments</option>
          {["UNPAID", "PARTIAL", "PAID", "REFUNDED", "OVERPAID"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Button type="submit">Search</Button>
      </form>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => runBulk("repeat")} data-testid="bulk-repeat">
          Bulk repeat
        </Button>
        <Button type="button" variant="secondary" onClick={() => runBulk("status")} data-testid="bulk-status">
          Bulk → Fulfilling
        </Button>
        <p className="self-center text-xs opacity-70">{total} orders · page {page}/{totalPages}</p>
      </div>
      {message ? (
        <p className="text-sm" data-testid="bulk-result">
          {message}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b text-xs uppercase opacity-60">
            <tr>
              <th className="p-2" />
              <th className="p-2">Order</th>
              <th className="p-2">Customer</th>
              <th className="p-2">Status</th>
              <th className="p-2">Pay</th>
              <th className="p-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="p-4" colSpan={6}>
                  Loading…
                </td>
              </tr>
            ) : (
              orders.map((o) => (
                <tr key={o.id} className="border-b last:border-0">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={selected[o.id] != null}
                      onChange={() => toggle(o)}
                      data-testid={`select-order-${o.id}`}
                    />
                  </td>
                  <td className="p-2">
                    <Link className="font-semibold underline" href={`/admin/orders/${o.id}`}>
                      #{o.orderNumber ?? "—"}
                    </Link>
                    <div className="text-xs opacity-60">{o.draftRef}</div>
                  </td>
                  <td className="p-2">{o.customer?.displayName ?? "—"}</td>
                  <td className="p-2">{o.status}</td>
                  <td className="p-2">{o.paymentStatusCached}</td>
                  <td className="p-2">
                    {o.expectedTotalCents != null
                      ? `$${(o.expectedTotalCents / 100).toFixed(2)}`
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Prev
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
          data-testid="orders-next-page"
        >
          Next
        </Button>
      </div>
    </div>
  );
}
