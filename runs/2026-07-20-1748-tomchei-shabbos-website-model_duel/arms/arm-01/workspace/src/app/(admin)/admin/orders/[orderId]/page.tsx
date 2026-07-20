import { notFound } from "next/navigation";
import { OrderMoneyActions } from "@/components/admin-order-actions";
import { BackLink } from "@/components/back-link";
import { getOrderDetail } from "@/lib/admin-operations";
import { requirePermission } from "@/lib/auth";
import { formatCurrency } from "@/lib/currency";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const session = await requirePermission("admin:view");
  const { orderId } = await params;
  const order = await getOrderDetail(orderId);
  if (!order) notFound();
  const paymentIds = order.payments.map((payment) => payment.id);
  const canViewAudit = hasPermission(session.effective, "audit:view");
  const auditEvents = canViewAudit
    ? await db.auditLog.findMany({
        where: {
          OR: [
            { targetType: "Order", targetId: order.id },
            { targetType: "Payment", targetId: { in: paymentIds } },
          ],
        },
        orderBy: { occurredAt: "desc" },
        take: 50,
      })
    : [];
  const paidCents = order.payments
    .filter((payment) => payment.status === "POSTED")
    .reduce((sum, payment) => sum + payment.amountCents - payment.refundedCents, 0);

  return (
    <div>
      <BackLink fallback="/admin/orders" />
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">{order.season.name}</p>
          <h1 className="mt-2 text-4xl font-black">Order #{order.orderNumber ?? order.draftReference}</h1>
          <p className="mt-2 text-[var(--muted)]">{order.customer.displayName} · {order.customer.email ?? order.customer.phone ?? "No contact"}</p>
        </div>
        <div className="text-right"><p className="text-3xl font-black">{formatCurrency(order.totalCents)}</p><p className="text-sm font-bold">{order.status} · {order.cachedPaymentStatus}</p></div>
      </div>
      <div className="mt-8 grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
            <h2 className="text-xl font-bold">Gifts and recipients</h2>
            <div className="mt-4 divide-y divide-[var(--border)]">
              {order.lines.map((line) => (
                <div className="grid gap-2 py-4 sm:grid-cols-[1fr_auto]" key={line.id}>
                  <div><p className="font-bold">{line.quantity} × {line.productNameSnapshot}</p><p className="text-sm text-[var(--muted)]">{line.recipientAddress?.recipientName ?? "Recipient pending"} · {line.fulfillmentMethod?.displayName ?? "Fulfillment pending"}</p><p className="text-sm">{line.greetingSnapshot || "No greeting"}</p></div>
                  <p className="font-semibold">{formatCurrency(line.unitPriceCentsSnapshot * line.quantity + line.fulfillmentFeeCentsSnapshot)}</p>
                </div>
              ))}
            </div>
          </section>
          {canViewAudit && (
            <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
              <h2 className="text-xl font-bold">Audit trail</h2>
              <div className="mt-4 divide-y divide-[var(--border)]">
                {auditEvents.map((event) => <div className="py-3" key={event.id}><p className="font-semibold">{event.action}</p><p className="text-xs text-[var(--muted)]">{event.occurredAt.toLocaleString()} · {event.actorStaffId ?? "System"}</p></div>)}
                {!auditEvents.length && <p className="py-5 text-[var(--muted)]">No audit events for this order yet.</p>}
              </div>
            </section>
          )}
        </div>
        <section className="h-fit rounded-3xl border border-[var(--border)] bg-white p-6">
          <h2 className="text-xl font-bold">Money actions</h2>
          <dl className="my-5 space-y-2 text-sm"><div className="flex justify-between"><dt>Paid</dt><dd>{formatCurrency(paidCents)}</dd></div><div className="flex justify-between font-bold"><dt>Balance</dt><dd>{formatCurrency(Math.max(0, order.totalCents - paidCents))}</dd></div></dl>
          <OrderMoneyActions
            balanceCents={Math.max(0, order.totalCents - paidCents)}
            canManagePayments={hasPermission(session.effective, "payments:manage")}
            orderId={order.id}
            payments={order.payments}
          />
        </section>
      </div>
    </div>
  );
}
