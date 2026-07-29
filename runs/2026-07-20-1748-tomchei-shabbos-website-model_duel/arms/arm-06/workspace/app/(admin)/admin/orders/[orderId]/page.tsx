import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { CHANNEL_LABELS } from "@/lib/packages/fulfillment";
import { Card, CardTitle } from "@/components/ui/card";
import { BackLink } from "@/components/admin/back-link";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/order-badges";
import { OrderActions } from "@/app/(admin)/admin/orders/[orderId]/order-actions";
import { OrderPackagesCard } from "@/app/(admin)/admin/orders/[orderId]/order-packages-card";

export const metadata: Metadata = { title: "Order detail" };
export const dynamic = "force-dynamic";

// R-053/R-054: order detail — lines, recipients, money panel (post/void/
// refund with audit), repeat + discard. The audit slice is bounded to the
// newest events touching this order or its payments.
export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await requirePermission("payments.manage");
  const { orderId } = await params;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      lines: { orderBy: { createdAt: "asc" } },
      recipients: { orderBy: { createdAt: "asc" } },
      payments: { orderBy: { createdAt: "asc" } },
      customer: true,
      season: true,
      packages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          recipientName: true,
          stage: true,
          channel: true,
          fulfillmentMethod: { select: { label: true } },
          _count: { select: { lines: true } },
        },
      },
    },
  });
  if (!order) notFound();

  const paymentIds = order.payments.map((payment) => payment.id);
  const audits = await prisma.auditLog.findMany({
    where: {
      OR: [
        { targetType: "Order", targetId: order.id },
        { targetType: "Payment", targetId: { in: paymentIds } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 25,
  });

  const productLines = order.lines.filter((line) => line.productId !== null);
  const addOnLines = order.lines.filter((line) => line.addOnId !== null);
  const paidCents = order.payments
    .filter((payment) => payment.status === "POSTED")
    .reduce((sum, payment) => sum + payment.amountCents, 0);

  return (
    <div>
      <BackLink href="/admin/orders" label="All orders" />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold" data-order-heading>
          {order.wireFormat ?? order.draftRef ?? order.id}
        </h1>
        <OrderStatusBadge status={order.status} />
        <PaymentStatusBadge status={order.paymentStatus} />
      </div>
      <p className="mt-1 text-sm text-stone-500">
        Season {order.season.name} · placed {order.createdAt.toISOString().slice(0, 10)} ·{" "}
        <Link href={`/admin/customers/${order.customerId}`} className="text-brand-700 hover:underline">
          {order.customer.name} ({order.customer.email})
        </Link>
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <CardTitle>Lines</CardTitle>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {productLines.map((line) => (
              <li key={line.id} className="flex justify-between gap-4">
                <span>
                  {line.qty} × {line.productName}
                  {line.optionLabel ? ` (${line.optionLabel})` : ""}
                  {addOnLines
                    .filter((addOn) => addOn.parentLineId === line.id)
                    .map((addOn) => ` +${addOn.qty} × ${addOn.productName}`)
                    .join("")}
                </span>
                <span className="font-medium">
                  {formatCents(
                    line.lineTotalCents +
                      addOnLines
                        .filter((addOn) => addOn.parentLineId === line.id)
                        .reduce((sum, addOn) => sum + addOn.lineTotalCents, 0),
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-stone-200 pt-3 text-sm">
            <div className="flex justify-between">
              <span>Delivery fees</span>
              <span>{formatCents(order.deliveryFeesCents)}</span>
            </div>
            <div className="mt-1 flex justify-between text-base font-semibold">
              <span>Total</span>
              <span data-order-total>{formatCents(order.totalCents)}</span>
            </div>
            <div className="mt-1 flex justify-between text-stone-600">
              <span>Collected</span>
              <span data-order-collected>{formatCents(paidCents)}</span>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <CardTitle>Recipients</CardTitle>
          <ul className="mt-3 flex flex-col gap-3 text-sm">
            {order.recipients.map((recipient) => (
              <li key={recipient.id}>
                <p className="font-medium text-stone-900">{recipient.name}</p>
                <p className="text-stone-600">
                  {recipient.line1}
                  {recipient.line2 ? `, ${recipient.line2}` : ""}, {recipient.city}, {recipient.region}{" "}
                  {recipient.postalCode}
                </p>
                <p className="text-xs text-stone-500">
                  {recipient.fulfillmentChoice ?? "no fulfillment choice"}
                  {recipient.deliveryDay ? ` · ${recipient.deliveryDay}` : ""}
                  {recipient.deliveryFeeCents ? ` · fee ${formatCents(recipient.deliveryFeeCents)}` : ""}
                </p>
              </li>
            ))}
            {order.recipients.length === 0 && <li className="text-stone-500">No recipients yet.</li>}
          </ul>
        </Card>
      </div>

      <div className="mt-6">
        <OrderPackagesCard
          orderId={order.id}
          packages={order.packages.map((pkg) => ({
            id: pkg.id,
            recipientName: pkg.recipientName,
            stage: pkg.stage,
            channelLabel: CHANNEL_LABELS[pkg.channel],
            methodLabel: pkg.fulfillmentMethod.label,
            lineCount: pkg._count.lines,
          }))}
        />
      </div>

      <OrderActions
        orderId={order.id}
        status={order.status}
        totalCents={order.totalCents}
        outstandingCents={Math.max(0, order.totalCents - paidCents)}
        payments={order.payments.map((payment) => ({
          id: payment.id,
          method: payment.method,
          amountCents: payment.amountCents,
          status: payment.status,
          voidReason: payment.voidReason,
          refundRef: payment.refundRef,
          externalRef: payment.externalRef,
          created: payment.createdAt.toISOString().slice(0, 10),
        }))}
      />

      <Card className="mt-6 p-5">
        <CardTitle>Audit trail</CardTitle>
        <ul className="mt-3 flex flex-col gap-1.5 text-sm" data-order-audit>
          {audits.map((entry) => (
            <li key={entry.id} className="flex flex-wrap gap-x-3 text-stone-700">
              <span className="text-xs text-stone-500">{entry.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
              <span className="font-medium">{entry.action}</span>
              <span>{entry.actorEmail ?? "system"}</span>
            </li>
          ))}
          {audits.length === 0 && <li className="text-stone-500">No audited events on this order yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
