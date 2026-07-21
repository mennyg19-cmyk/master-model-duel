"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Payment = {
  id: string;
  method: string;
  state: string;
  amountCents: number;
  refundedCents: number;
  reference: string | null;
  stripeChargeId: string | null;
  postedBy: { displayName: string } | null;
};

  type OrderDetail = {
  id: string;
  orderNumber: number | null;
  draftRef: string;
  status: string;
  paymentStatusCached: string;
  expectedTotalCents: number | null;
  version: number;
  customer: { id: string; displayName: string; email: string | null } | null;
  lines: Array<{ id: string; product: { name: string }; quantity: number; unitPriceCents: number }>;
  payments: Payment[];
  packages?: Array<{
    id: string;
    recipientName: string;
    stage: string;
    fulfillmentMethod: { code: string };
  }>;
};

type ShippingLabelRow = {
  id: string;
  packageId: string;
  status: string;
  carrier: string;
  chargedCents: number;
  purchasedCents: number;
  marginCents: number;
  trackingNumber: string | null;
  routeAssignedAt: string | null;
};

export function OrderDetailClient({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [audits, setAudits] = useState<Array<{ id: string; action: string; createdAt: string; actor?: { displayName: string } | null }>>([]);
  const [labels, setLabels] = useState<ShippingLabelRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundPaymentId, setRefundPaymentId] = useState("");

  async function load() {
    const res = await fetch(`/api/admin/orders/${orderId}`);
    const json = await res.json();
    if (res.ok) {
      setOrder(json.order);
      setAudits(json.audits ?? []);
      const first = json.order.payments?.find(
        (p: Payment) => p.state === "POSTED" && p.amountCents - p.refundedCents > 0,
      );
      if (first) {
        setRefundPaymentId(first.id);
        setRefundAmount(String(first.amountCents - first.refundedCents));
      }
    }
    const labelRes = await fetch(`/api/admin/orders/${orderId}/labels`);
    const labelJson = await labelRes.json();
    if (labelRes.ok) setLabels(labelJson.labels ?? []);
  }

  useEffect(() => {
    void load();
  }, [orderId]);

  async function refund() {
    setMessage(null);
    const res = await fetch(`/api/admin/orders/${orderId}/refund`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paymentId: refundPaymentId,
        amountCents: Number.parseInt(refundAmount, 10),
        reason: "Admin refund",
      }),
    });
    const json = await res.json();
    setMessage(res.ok ? `Refunded. Stripe id: ${json.stripeRefundId ?? "n/a"}` : json.error || "Refund failed");
    if (res.ok) await load();
  }

  async function repeat() {
    setMessage(null);
    const res = await fetch(`/api/admin/orders/${orderId}/repeat`, { method: "POST" });
    const json = await res.json();
    setMessage(res.ok ? `Repeated → draft ${json.draftRef}` : json.error || "Repeat failed");
  }

  async function labelAction(packageId: string, action: "create" | "void") {
    setMessage(null);
    const res = await fetch(`/api/admin/orders/${orderId}/labels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, packageId }),
    });
    const json = await res.json();
    setMessage(
      res.ok
        ? action === "create"
          ? `Label bought · margin ${json.margin?.marginCents}¢`
          : `Voided ${json.labelId}`
        : json.error || "Label action failed",
    );
    if (res.ok) await load();
  }

  if (!order) {
    return <p className="text-sm">Loading order…</p>;
  }

  return (
    <div className="space-y-4" data-testid="order-detail">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/admin/orders" className="text-sm font-semibold text-[var(--color-leaf)]" data-testid="back-to-orders">
          ← Back to orders
        </Link>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={repeat} data-testid="repeat-order">
            Repeat order
          </Button>
        </div>
      </div>

      <header className="rounded bg-white p-5 shadow-sm">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
          Order #{order.orderNumber ?? "—"}
        </h1>
        <p className="mt-1 text-sm opacity-70">
          {order.status} · {order.paymentStatusCached} · {order.draftRef} · v{order.version}
        </p>
        {order.customer ? (
          <p className="mt-2 text-sm">
            Customer:{" "}
            <Link className="underline" href={`/admin/customers/${order.customer.id}`}>
              {order.customer.displayName}
            </Link>
          </p>
        ) : (
          <p className="mt-2 text-sm">Walk-in / no customer</p>
        )}
      </header>

      <section className="rounded bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Lines</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {order.lines.map((l) => (
            <li key={l.id}>
              {l.quantity}× {l.product.name} @ ${(l.unitPriceCents / 100).toFixed(2)}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 rounded bg-white p-5 shadow-sm" data-testid="money-actions">
        <h2 className="font-semibold">Money actions</h2>
        <ul className="space-y-2 text-sm">
          {order.payments.map((p) => (
            <li key={p.id} className="rounded border px-3 py-2">
              {p.method} {p.state}: ${(p.amountCents / 100).toFixed(2)}
              {p.refundedCents ? ` (refunded $${(p.refundedCents / 100).toFixed(2)})` : ""}
              {p.postedBy ? ` · by ${p.postedBy.displayName}` : ""}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Payment
            <select
              className="mt-1 block rounded border px-2 py-1.5"
              value={refundPaymentId}
              onChange={(e) => setRefundPaymentId(e.target.value)}
              data-testid="refund-payment-select"
            >
              {order.payments.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.method} · remaining ${(p.amountCents - p.refundedCents) / 100}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Amount ¢
            <input
              className="mt-1 block rounded border px-2 py-1.5"
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              data-testid="refund-amount"
            />
          </label>
          <Button type="button" onClick={refund} data-testid="refund-submit">
            Refund
          </Button>
        </div>
      </section>

      <section className="rounded bg-white p-5 shadow-sm" data-testid="order-labels">
        <h2 className="font-semibold">Shipping labels</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {(order.packages ?? [])
            .filter((p) => p.fulfillmentMethod.code === "SHIP")
            .map((pkg) => (
              <li key={pkg.id} className="flex flex-wrap items-center gap-2 rounded border px-3 py-2">
                <span>
                  {pkg.recipientName} · {pkg.stage}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void labelAction(pkg.id, "create")}
                  data-testid={`order-label-create-${pkg.id}`}
                >
                  Buy label
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void labelAction(pkg.id, "void")}
                  data-testid={`order-label-void-${pkg.id}`}
                >
                  Void
                </Button>
              </li>
            ))}
        </ul>
        {labels.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs opacity-80" data-testid="order-label-list">
            {labels.map((l) => (
              <li key={l.id}>
                {l.status} · {l.carrier} · charge {l.chargedCents}¢ / buy {l.purchasedCents}¢ /
                margin {l.marginCents}¢ · {l.trackingNumber ?? "no track"}
                {l.routeAssignedAt ? " · on route" : " · voidable"}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="rounded bg-white p-5 shadow-sm" data-testid="order-audit">
        <h2 className="font-semibold">Audit</h2>
        <ul className="mt-2 space-y-1 text-xs">
          {audits.map((a) => (
            <li key={a.id}>
              {a.action} · {a.actor?.displayName ?? "system"} · {new Date(a.createdAt).toLocaleString()}
            </li>
          ))}
        </ul>
      </section>

      {message ? (
        <p className="text-sm" data-testid="order-detail-message">
          {message}
        </p>
      ) : null}
    </div>
  );
}
