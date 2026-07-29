"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { PaymentMethod } from "@prisma/client";
import { apiFetch } from "@/lib/api-fetch";
import { dollarsToCents, formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export interface PaymentRow {
  id: string;
  method: PaymentMethod;
  amountCents: number;
  status: "POSTED" | "VOIDED";
  voidReason: string | null;
  refundRef: string | null;
  externalRef: string | null;
  created: string;
}

// R-053/R-054: the money panel — post offline payments, void with a reason,
// refund posted card payments through Stripe. Every action round-trips
// through the server and refreshes; statuses never change optimistically.
export function OrderActions({
  orderId,
  status,
  totalCents,
  outstandingCents,
  payments,
}: {
  orderId: string;
  status: "DRAFT" | "FINALIZED" | "DISCARDED";
  totalCents: number;
  outstandingCents: number;
  payments: PaymentRow[];
}) {
  const router = useRouter();
  const [method, setMethod] = useState<"CASH" | "CHECK" | "COMP">("CASH");
  const [amount, setAmount] = useState((outstandingCents / 100).toFixed(2));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [repeatedRef, setRepeatedRef] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<{ ok: boolean; body: { error?: string; note?: string } }>) {
    setBusy(label);
    setError(null);
    setNote(null);
    const result = await fn();
    setBusy(null);
    if (!result.ok) {
      setError(result.body.error ?? "Action failed");
      return false;
    }
    if (result.body.note) setNote(result.body.note);
    router.refresh();
    return true;
  }

  async function postPayment(event: FormEvent) {
    event.preventDefault();
    const amountCents = dollarsToCents(Number(amount));
    if (amountCents === null || amountCents <= 0) {
      setError("Amount must be a clean dollar-and-cents amount");
      return;
    }
    await run("post", () =>
      apiFetch(`/api/admin/orders/${orderId}/payments`, { method: "POST", body: { method, amountCents } }),
    );
  }

  async function voidPayment(paymentId: string) {
    const reason = window.prompt("Void reason (kept on the audit trail):");
    if (!reason) return;
    await run(`void-${paymentId}`, () =>
      apiFetch(`/api/admin/payments/${paymentId}/void`, { method: "POST", body: { reason } }),
    );
  }

  async function refundPayment(paymentId: string) {
    await run(`refund-${paymentId}`, () =>
      apiFetch<{ note?: string }>(`/api/admin/payments/${paymentId}/refund`, { method: "POST", body: {} }),
    );
  }

  async function repeatOrder() {
    setRepeatedRef(null);
    await run("repeat", async () => {
      const result = await apiFetch<{ report?: { results: { outcome: string; reason?: string; draftRef?: string }[] } }>(
        "/api/admin/orders/bulk",
        { method: "POST", body: { action: "repeat", orderIds: [orderId] } },
      );
      const first = result.body.report?.results[0];
      if (result.ok && first && first.outcome !== "skipped") {
        setRepeatedRef(first.draftRef ?? null);
        return result;
      }
      return { ok: false, body: { error: first?.reason ?? result.body.error ?? "Could not repeat the order" } };
    });
  }

  async function discardOrder() {
    if (!window.confirm("Discard this draft? Stock reservations release immediately.")) return;
    await run("discard", () =>
      apiFetch("/api/admin/orders/bulk", { method: "POST", body: { action: "discard", orderIds: [orderId] } }),
    );
  }

  return (
    <Card className="mt-6 p-5" data-money-panel>
      <CardTitle>Money</CardTitle>
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
      {note && <p className="mt-2 text-sm text-amber-800">{note}</p>}
      {repeatedRef && (
        <p className="mt-2 text-sm text-green-800">
          Repeated as draft <span className="font-medium">{repeatedRef}</span> — open it from the orders list.
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-2 text-sm">
        {payments.map((payment) => (
          <li
            key={payment.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-stone-200 px-3 py-2"
            data-payment-row={payment.id}
          >
            <span className="flex items-center gap-2">
              <span className="font-medium">{payment.method}</span>
              <span>{formatCents(payment.amountCents)}</span>
              <Badge tone={payment.status === "POSTED" ? "green" : "stone"}>{payment.status}</Badge>
              {payment.refundRef && <Badge tone="amber">refunded</Badge>}
            </span>
            <span className="flex items-center gap-2 text-xs text-stone-500">
              {payment.created}
              {payment.status === "POSTED" && (
                <>
                  {payment.method === "STRIPE" && payment.externalRef && (
                    <button
                      type="button"
                      className="font-medium text-red-700 hover:underline"
                      disabled={busy !== null}
                      onClick={() => refundPayment(payment.id)}
                      data-refund={payment.id}
                    >
                      {busy === `refund-${payment.id}` ? "Refunding…" : "Refund"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="font-medium text-stone-700 hover:underline"
                    disabled={busy !== null}
                    onClick={() => voidPayment(payment.id)}
                    data-void={payment.id}
                  >
                    {busy === `void-${payment.id}` ? "Voiding…" : "Void"}
                  </button>
                </>
              )}
            </span>
            {payment.voidReason && <span className="w-full text-xs text-stone-500">Voided: {payment.voidReason}</span>}
          </li>
        ))}
        {payments.length === 0 && <li className="text-stone-500">No payments yet.</li>}
      </ul>

      {status === "FINALIZED" && outstandingCents > 0 && (
        <form onSubmit={postPayment} className="mt-4 flex flex-wrap items-end gap-3" data-post-payment>
          <div>
            <Label htmlFor="pay-method">Method</Label>
            <Select
              id="pay-method"
              className="mt-1"
              value={method}
              onChange={(event) => setMethod(event.target.value as "CASH" | "CHECK" | "COMP")}
            >
              <option value="CASH">Cash</option>
              <option value="CHECK">Check</option>
              <option value="COMP">Comp</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="pay-amount">Amount</Label>
            <Input
              id="pay-amount"
              className="mt-1 w-28"
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <Button type="submit" size="sm" disabled={busy !== null}>
            {busy === "post" ? "Posting…" : `Post payment (${formatCents(outstandingCents)} due)`}
          </Button>
        </form>
      )}

      <div className="mt-4 flex flex-wrap gap-3 border-t border-stone-200 pt-4">
        {status === "FINALIZED" && (
          <Button variant="secondary" size="sm" onClick={repeatOrder} disabled={busy !== null} data-repeat-order>
            {busy === "repeat" ? "Repeating…" : "Repeat as new draft"}
          </Button>
        )}
        {status === "DRAFT" && (
          <Button variant="danger" size="sm" onClick={discardOrder} disabled={busy !== null} data-discard-order>
            {busy === "discard" ? "Discarding…" : "Discard draft"}
          </Button>
        )}
      </div>
    </Card>
  );
}
