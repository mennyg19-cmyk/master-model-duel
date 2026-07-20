"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/catalog";
import { Badge } from "@/components/ui/badge";

// Money actions on the order detail page (R-053, R-054): posts hit the P5
// staff APIs (payments post/void/refund, finalize/discard) and refresh the
// server-rendered page — the page stays the single source of truth.

type PaymentRow = {
  id: string;
  method: string;
  state: string;
  amountCents: number;
  note: string | null;
  receivedAt: string;
  isStripeRefund: boolean;
};

export function OrderMoneyActions({
  orderId,
  orderStatus,
  balanceCents,
  can,
  payments,
}: {
  orderId: string;
  orderStatus: string;
  balanceCents: number;
  can: { record: boolean; refund: boolean; manage: boolean };
  payments: PaymentRow[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<"CASH" | "CHECK" | "COMP">("CASH");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [refundAmount, setRefundAmount] = useState("");

  async function call(path: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error ?? `Request failed (${response.status})`);
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  const parseDollars = (raw: string): number | null => {
    const value = Math.round(Number.parseFloat(raw) * 100);
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  async function postPayment(event: React.FormEvent) {
    event.preventDefault();
    const amountCents = parseDollars(amount);
    if (!amountCents) {
      setError("Enter a payment amount in dollars");
      return;
    }
    const ok = await call(`/api/admin/orders/${orderId}/payments`, {
      method,
      amountCents,
      note: note || undefined,
    });
    if (ok) {
      setAmount("");
      setNote("");
      setNotice("Payment posted.");
    }
  }

  async function refund(event: React.FormEvent) {
    event.preventDefault();
    const amountCents = refundAmount ? parseDollars(refundAmount) : undefined;
    if (refundAmount && !amountCents) {
      setError("Refund amount must be a positive dollar value");
      return;
    }
    const ok = await call(`/api/admin/orders/${orderId}/refund`, amountCents ? { amountCents } : {});
    if (ok) {
      setRefundAmount("");
      setNotice("Refund issued.");
    }
  }

  return (
    <div>
      {payments.length === 0 ? (
        <p className="text-sm text-muted mb-3">No payments recorded.</p>
      ) : (
        <table className="w-full text-sm mb-3">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-1.5 pr-3">When</th>
              <th className="py-1.5 pr-3">Method</th>
              <th className="py-1.5 pr-3">Amount</th>
              <th className="py-1.5 pr-3">Note</th>
              <th className="py-1.5 pr-3">State</th>
              <th className="py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.id} className="border-b border-border last:border-0">
                <td className="py-1.5 pr-3 whitespace-nowrap text-muted">
                  {payment.receivedAt.slice(0, 16).replace("T", " ")}
                </td>
                <td className="py-1.5 pr-3">
                  {payment.method}
                  {payment.isStripeRefund && <span className="text-xs text-muted"> (refund)</span>}
                </td>
                <td className={`py-1.5 pr-3 ${payment.amountCents < 0 ? "text-danger" : ""}`}>
                  {formatCents(payment.amountCents)}
                </td>
                <td className="py-1.5 pr-3 text-muted">{payment.note ?? ""}</td>
                <td className="py-1.5 pr-3">
                  <Badge tone={payment.state === "POSTED" ? "success" : "neutral"}>{payment.state}</Badge>
                </td>
                <td className="py-1.5 text-right">
                  {can.record && payment.state === "POSTED" && payment.method !== "STRIPE" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => call(`/api/admin/orders/${orderId}/payments/${payment.id}/void`)}
                      className="text-xs text-danger hover:underline disabled:opacity-50"
                    >
                      Void
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      {notice && <p className="mb-2 text-sm text-success">{notice}</p>}

      <div className="flex flex-wrap gap-6">
        {can.record && orderStatus !== "DISCARDED" && (
          <form onSubmit={postPayment} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-xs text-muted">
              Method
              <select
                value={method}
                onChange={(event) => setMethod(event.target.value as typeof method)}
                className="mt-1 rounded-md border border-border bg-white px-2 py-1.5 text-sm text-ink"
              >
                <option value="CASH">Cash</option>
                <option value="CHECK">Check</option>
                <option value="COMP">Comp</option>
              </select>
            </label>
            <label className="flex flex-col text-xs text-muted">
              Amount ($)
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder={balanceCents > 0 ? (balanceCents / 100).toFixed(2) : "0.00"}
                className="mt-1 w-28 rounded-md border border-border bg-white px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <label className="flex flex-col text-xs text-muted">
              Note
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                className="mt-1 w-44 rounded-md border border-border bg-white px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
            >
              Post payment
            </button>
          </form>
        )}

        {can.refund && (
          <form onSubmit={refund} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-xs text-muted">
              Refund ($, blank = full)
              <input
                value={refundAmount}
                onChange={(event) => setRefundAmount(event.target.value)}
                inputMode="decimal"
                placeholder="Full remaining"
                className="mt-1 w-32 rounded-md border border-border bg-white px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-danger hover:bg-red-50 disabled:opacity-50"
            >
              Refund Stripe payment
            </button>
          </form>
        )}
      </div>

      {can.manage && orderStatus === "DRAFT" && (
        <div className="mt-4 flex gap-2 border-t border-border pt-3">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (await call(`/api/admin/orders/${orderId}/finalize`)) setNotice("Order finalized.");
            }}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
          >
            Finalize order
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (await call(`/api/admin/orders/${orderId}/discard`)) setNotice("Order discarded.");
            }}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-danger hover:bg-red-50 disabled:opacity-50"
          >
            Discard order
          </button>
        </div>
      )}
    </div>
  );
}
