import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermissionPage } from "@/lib/auth/current-user";
import { formatCents } from "@/lib/catalog";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/order-badges";
import { OrderMoneyActions } from "@/components/admin/order-money-actions";
import { FulfillmentActions } from "@/components/admin/fulfillment-actions";
import { ShipmentActions } from "@/components/admin/shipment-actions";
import { RepeatOrderButton } from "@/components/admin/repeat-order-button";

const AUDIT_LIMIT = 50;

/** Full order detail with money actions (R-053, R-054) and the per-order audit trail. */
export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePermissionPage("orders.view");
  const { id } = await params;

  const order = await db.order.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
      season: { select: { name: true } },
      lines: {
        include: {
          product: { select: { name: true } },
          fulfillmentMethod: { select: { name: true, kind: true } },
          package: {
            select: {
              id: true,
              stage: true,
              recipientName: true,
              addressLine1: true,
              city: true,
              zip: true,
              shipments: { orderBy: { createdAt: "desc" }, take: 1 },
            },
          },
          options: { include: { productOption: { select: { name: true } } } },
          addOns: { include: { addOn: { select: { name: true } } } },
        },
        orderBy: { id: "asc" },
      },
      payments: { orderBy: [{ receivedAt: "asc" }, { id: "asc" }] },
    },
  });
  if (!order) notFound();

  const audit = await db.auditLog.findMany({
    where: { targetType: "Order", targetId: id },
    orderBy: { createdAt: "desc" },
    take: AUDIT_LIMIT,
  });

  const postedCents = order.payments
    .filter((payment) => payment.state === "POSTED")
    .reduce((sum, payment) => sum + payment.amountCents, 0);
  const permissions = staff.actingAs.permissions;
  // Only offer the refund form when the API can actually honor it: the order
  // isn't discarded, a posted Stripe charge exists, and refunds haven't already
  // consumed it (posted Stripe rows net positive).
  const stripePostedCents = order.payments
    .filter((payment) => payment.method === "STRIPE" && payment.state === "POSTED")
    .reduce((sum, payment) => sum + payment.amountCents, 0);
  const hasRefundableStripe =
    order.status !== "DISCARDED" &&
    stripePostedCents > 0 &&
    order.payments.some(
      (payment) =>
        payment.method === "STRIPE" &&
        payment.state === "POSTED" &&
        payment.amountCents > 0 &&
        payment.stripePaymentIntentId !== null
    );
  // Shipping labels live on packages; the order shows every shipping package
  // its lines landed in, deduplicated (R-055).
  const shippingPackages = [
    ...new Map(
      order.lines
        .filter((line) => line.fulfillmentMethod.kind === "SHIPPING" && line.package)
        .map((line) => [line.package!.id, line.package!])
    ).values(),
  ];
  const feeBreakdown = Array.isArray(order.feeBreakdown)
    ? (order.feeBreakdown as { label: string; amountCents: number }[])
    : [];

  return (
    <div>
      <Link href="/admin/orders" className="text-sm text-brand hover:underline">
        ← Back to orders
      </Link>
      <div className="mt-2 mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          {order.orderNumber ? `Order #${order.orderNumber}` : `Draft ${order.draftReference}`}
        </h1>
        <OrderStatusBadge status={order.status} />
        <PaymentStatusBadge status={order.paymentStatus} />
        <span className="text-sm text-muted">
          {order.season.name} · placed {order.createdAt.toISOString().slice(0, 16).replace("T", " ")}
        </span>
        {order.status === "FINALIZED" && (
          <a
            href={`/api/admin/orders/${order.id}/packing-slip`}
            target="_blank"
            className="text-sm text-brand hover:underline"
          >
            Packing slip (PDF)
          </a>
        )}
        {order.status === "FINALIZED" && permissions.has("fulfillment.manage") && (
          <FulfillmentActions mode="order" orderId={order.id} />
        )}
        {order.status === "FINALIZED" && permissions.has("orders.manage") && (
          <RepeatOrderButton orderId={order.id} />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardTitle className="mb-3">Items</CardTitle>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="py-1.5 pr-3">Product</th>
                  <th className="py-1.5 pr-3">Qty</th>
                  <th className="py-1.5 pr-3">Unit</th>
                  <th className="py-1.5 pr-3">Recipient</th>
                  <th className="py-1.5 pr-3">Method</th>
                  <th className="py-1.5">Package</th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((line) => (
                  <tr key={line.id} className="border-b border-border last:border-0 align-top">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{line.product.name}</span>
                      {(line.options.length > 0 || line.addOns.length > 0) && (
                        <span className="block text-xs text-muted">
                          {[
                            ...line.options.map((option) => option.productOption.name),
                            ...line.addOns.map((entry) =>
                              entry.quantity > 1 ? `${entry.addOn.name} ×${entry.quantity}` : entry.addOn.name
                            ),
                          ].join(", ")}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3">{line.quantity}</td>
                    <td className="py-2 pr-3">{formatCents(line.unitPriceCents)}</td>
                    <td className="py-2 pr-3">
                      <span className="block">{line.recipientName}</span>
                      <span className="text-xs text-muted">
                        {line.addressLine1}, {line.city} {line.zip}
                      </span>
                      {line.greeting && <span className="block text-xs italic text-muted">“{line.greeting}”</span>}
                    </td>
                    <td className="py-2 pr-3">{line.fulfillmentMethod.name}</td>
                    <td className="py-2">
                      {line.package ? <Badge tone="neutral">{line.package.stage}</Badge> : <span className="text-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 border-t border-border pt-3 text-sm space-y-1">
              <p className="flex justify-between">
                <span className="text-muted">Items</span>
                <span>{formatCents(order.itemsCents)}</span>
              </p>
              {feeBreakdown.map((fee, index) => (
                <p key={index} className="flex justify-between">
                  <span className="text-muted">{fee.label}</span>
                  <span>{formatCents(fee.amountCents)}</span>
                </p>
              ))}
              {feeBreakdown.length === 0 && order.feesCents > 0 && (
                <p className="flex justify-between">
                  <span className="text-muted">Fees</span>
                  <span>{formatCents(order.feesCents)}</span>
                </p>
              )}
              {order.donationCents > 0 && (
                <p className="flex justify-between">
                  <span className="text-muted">Donation</span>
                  <span>{formatCents(order.donationCents)}</span>
                </p>
              )}
              <p className="flex justify-between font-semibold">
                <span>Total</span>
                <span>{formatCents(order.totalCents)}</span>
              </p>
              <p className="flex justify-between">
                <span className="text-muted">Posted payments</span>
                <span>{formatCents(postedCents)}</span>
              </p>
              <p className="flex justify-between font-medium">
                <span>Balance</span>
                <span>{formatCents(order.totalCents - postedCents)}</span>
              </p>
            </div>
          </Card>

          {shippingPackages.length > 0 && permissions.has("fulfillment.manage") && (
            <Card>
              <CardTitle className="mb-3">Shipping labels</CardTitle>
              <div className="space-y-3">
                {shippingPackages.map((pkg) => (
                  <div key={pkg.id} className="rounded-md border border-border p-3">
                    <p className="mb-1 text-sm">
                      <span className="font-medium">{pkg.recipientName}</span>{" "}
                      <span className="text-muted">
                        — {pkg.addressLine1}, {pkg.city} {pkg.zip}
                      </span>{" "}
                      <Badge tone="neutral">{pkg.stage.replace("_", " ")}</Badge>
                    </p>
                    <ShipmentActions
                      packageId={pkg.id}
                      shipment={pkg.shipments[0] ?? null}
                      shipped={pkg.stage === "SENT" || pkg.stage === "PICKED_UP"}
                    />
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <CardTitle className="mb-3">Payments</CardTitle>
            <OrderMoneyActions
              orderId={order.id}
              orderStatus={order.status}
              balanceCents={order.totalCents - postedCents}
              can={{
                record: permissions.has("payments.record"),
                refund: permissions.has("payments.refund") && hasRefundableStripe,
                manage: permissions.has("orders.manage"),
              }}
              payments={order.payments.map((payment) => ({
                id: payment.id,
                method: payment.method,
                state: payment.state,
                amountCents: payment.amountCents,
                note: payment.note,
                receivedAt: payment.receivedAt.toISOString(),
                isStripeRefund: payment.stripeRefundId !== null,
              }))}
            />
          </Card>

          <Card>
            <CardTitle className="mb-3">Audit trail</CardTitle>
            {audit.length === 0 ? (
              <p className="text-sm text-muted">No audit entries for this order yet.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {audit.map((entry) => (
                    <tr key={entry.id} className="border-b border-border last:border-0 align-top">
                      <td className="py-1.5 pr-3 whitespace-nowrap text-muted">
                        {entry.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                      </td>
                      <td className="py-1.5 pr-3">{entry.actorEmail}</td>
                      <td className="py-1.5 pr-3 font-mono text-xs">{entry.action}</td>
                      <td className="py-1.5 font-mono text-xs break-all">
                        {entry.detail ? JSON.stringify(entry.detail) : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardTitle className="mb-2">Customer</CardTitle>
            <Link href={`/admin/customers/${order.customer.id}`} className="font-medium text-brand hover:underline">
              {order.customer.name}
            </Link>
            <p className="text-sm text-muted">{order.customer.email}</p>
            {order.customer.phone && <p className="text-sm text-muted">{order.customer.phone}</p>}
          </Card>
          <Card>
            <CardTitle className="mb-2">Order facts</CardTitle>
            <dl className="text-sm space-y-1">
              <div className="flex justify-between">
                <dt className="text-muted">Reference</dt>
                <dd className="font-mono text-xs">{order.draftReference}</dd>
              </div>
              {order.deliveryDay && (
                <div className="flex justify-between">
                  <dt className="text-muted">Delivery day</dt>
                  <dd>{order.deliveryDay}</dd>
                </div>
              )}
              {order.greetingDefault && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Default greeting</dt>
                  <dd className="text-right italic">“{order.greetingDefault}”</dd>
                </div>
              )}
              {order.finalizedAt && (
                <div className="flex justify-between">
                  <dt className="text-muted">Finalized</dt>
                  <dd>{order.finalizedAt.toISOString().slice(0, 16).replace("T", " ")}</dd>
                </div>
              )}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
