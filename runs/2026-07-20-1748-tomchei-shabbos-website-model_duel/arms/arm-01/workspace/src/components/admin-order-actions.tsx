"use client";

import { useId, useState } from "react";

export function BulkRepeatButton({
  orders,
}: {
  orders: { id: string; version: number; status: string }[];
}) {
  const [message, setMessage] = useState("");
  async function repeatPage() {
    const sources = orders
      .filter((order) => order.status === "FINALIZED")
      .map((order) => ({ orderId: order.id, version: order.version }));
    if (!sources.length) {
      setMessage("No finalized orders on this page.");
      return;
    }
    const response = await fetch("/api/admin/orders/bulk-repeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sources }),
    });
    const payload = await response.json();
    setMessage(
      response.ok
        ? `${payload.applied.length} repeated; ${payload.conflicts.length} conflicts.`
        : payload.error,
    );
  }
  return (
    <div className="text-right">
      <button className="rounded-xl bg-[var(--ink)] px-5 py-3 font-bold text-white" onClick={() => void repeatPage()} type="button">
        Repeat finalized on page
      </button>
      {message && <p aria-live="polite" className="mt-2 text-sm">{message}</p>}
    </div>
  );
}

export function OrderMoneyActions({
  orderId,
  balanceCents,
  canManagePayments,
  payments,
}: {
  orderId: string;
  balanceCents: number;
  canManagePayments: boolean;
  payments: { id: string; method: string; status: string; amountCents: number; refundedCents: number; reference: string | null }[];
}) {
  const refundFormId = useId();
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function postPayment(formData: FormData) {
    setIsBusy(true);
    const response = await fetch(`/api/admin/orders/${orderId}/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        method: formData.get("method"),
        amountCents: Math.round(Number(formData.get("amount")) * 100),
        reference: formData.get("reference"),
      }),
    });
    const payload = await response.json();
    setMessage(response.ok ? "Payment posted and audited." : payload.error);
    setIsBusy(false);
    if (response.ok) window.location.reload();
  }

  async function refund(formData: FormData) {
    setIsBusy(true);
    const response = await fetch(`/api/admin/orders/${orderId}/refunds`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paymentId: formData.get("paymentId"),
        amountCents: Math.round(Number(formData.get("amount")) * 100),
        reason: formData.get("reason"),
        idempotencyKey: formData.get("idempotencyKey"),
      }),
    });
    const payload = await response.json();
    setMessage(response.ok ? "Refund submitted and audited." : payload.error);
    setIsBusy(false);
    if (response.ok) window.location.reload();
  }

  if (!canManagePayments) {
    return <p className="rounded-xl bg-[var(--surface)] p-4 text-sm">Payment controls require the payments permission.</p>;
  }
  return (
    <div className="space-y-5">
      {balanceCents > 0 && (
        <form action={postPayment} className="grid gap-3 sm:grid-cols-2">
          <select className="rounded-xl border border-[var(--border)] px-3 py-2" name="method"><option value="CASH">Cash</option><option value="CHECK">Check</option></select>
          <input className="rounded-xl border border-[var(--border)] px-3 py-2" defaultValue={(balanceCents / 100).toFixed(2)} min="0.01" name="amount" step="0.01" type="number" />
          <input className="rounded-xl border border-[var(--border)] px-3 py-2" maxLength={120} name="reference" placeholder="Receipt or check number" required />
          <button className="rounded-xl bg-[var(--ink)] px-4 py-2 font-bold text-white disabled:opacity-50" disabled={isBusy}>Post payment</button>
        </form>
      )}
      {payments.filter((payment) => payment.status === "POSTED" && payment.refundedCents < payment.amountCents).map((payment) => (
        <form action={refund} className="grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-2" key={payment.id}>
          <input name="paymentId" type="hidden" value={payment.id} />
          <input name="idempotencyKey" type="hidden" value={`${refundFormId}:${payment.id}:${payment.refundedCents}`} />
          <p className="font-semibold">{payment.method} · {payment.reference ?? "No reference"}</p>
          <input className="rounded-xl border border-[var(--border)] px-3 py-2" defaultValue={((payment.amountCents - payment.refundedCents) / 100).toFixed(2)} max={((payment.amountCents - payment.refundedCents) / 100).toFixed(2)} min="0.01" name="amount" step="0.01" type="number" />
          <input className="rounded-xl border border-[var(--border)] px-3 py-2" name="reason" placeholder="Refund reason" required />
          <button className="rounded-xl border border-[var(--danger)] px-4 py-2 font-bold text-[var(--danger)] disabled:opacity-50" disabled={isBusy}>Refund</button>
        </form>
      ))}
      {message && <p aria-live="polite" className="rounded-xl bg-[var(--brand-soft)] p-3 text-sm font-semibold">{message}</p>}
    </div>
  );
}
