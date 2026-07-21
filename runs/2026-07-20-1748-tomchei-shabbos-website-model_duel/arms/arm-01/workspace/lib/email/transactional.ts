import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { BRAND } from "@/lib/brand";
import { captureNotification } from "@/lib/notifications";
import { formatCents } from "@/lib/catalog";
import { resolveTemplate, renderTemplate, type TemplateKey } from "@/lib/email/templates";

// Order lifecycle emails (R-087): confirmation, payment link, refund. Each
// enqueue rides the caller's transaction and is idempotent through the outbox
// dedupeKey, so retried webhooks / double-clicked staff buttons never produce
// a second email. A key disabled in the template registry enqueues nothing.

async function enqueueTemplated(
  key: TemplateKey,
  target: { email: string; customerId: string; orderId: string },
  values: Record<string, string>,
  dedupeKey: string,
  tx: Prisma.TransactionClient = db
): Promise<boolean> {
  const template = await resolveTemplate(key, tx);
  if (!template.isEnabled) return false;
  return captureNotification(
    {
      channel: "EMAIL",
      recipient: target.email,
      kind: key,
      subject: renderTemplate(template.subject, values),
      body: renderTemplate(template.body, values),
      dedupeKey,
      customerId: target.customerId,
      orderId: target.orderId,
    },
    tx
  );
}

/**
 * Called from finalizeOrder's transaction: confirmation always, plus the
 * payment-link email when the order still carries an open balance (a staff
 * finalize without money in hand — web/POS orders are paid before finalize).
 */
export async function enqueueOrderLifecycleEmails(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      customer: { select: { id: true, email: true, name: true } },
      payments: { where: { state: "POSTED" }, select: { amountCents: true } },
      _count: { select: { lines: true } },
    },
  });
  const values = {
    orgName: BRAND.name,
    customerName: order.customer.name,
    orderNumber: String(order.orderNumber ?? ""),
    total: formatCents(order.totalCents),
    recipientCount: String(order._count.lines),
  };
  const target = { email: order.customer.email, customerId: order.customer.id, orderId };

  await enqueueTemplated("order_confirmation", target, values, `order-confirmation|${orderId}`, tx);

  const paid = order.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const owedCents = order.totalCents - paid;
  if (owedCents > 0) {
    await enqueueTemplated(
      "payment_link",
      target,
      { ...values, owed: formatCents(owedCents), orderUrl: `${env.APP_URL}/account/orders/${orderId}` },
      `payment-link|${orderId}`,
      tx
    );
  }
}

/** Refund notice, keyed by the Stripe refund id — replayed syncs enqueue once. */
export async function enqueueRefundEmail(
  entry: { orderId: string; amountCents: number; stripeRefundId: string },
  tx: Prisma.TransactionClient = db
): Promise<boolean> {
  const order = await tx.order.findUnique({
    where: { id: entry.orderId },
    include: { customer: { select: { id: true, email: true, name: true } } },
  });
  if (!order) return false;
  return enqueueTemplated(
    "refund_notice",
    { email: order.customer.email, customerId: order.customer.id, orderId: entry.orderId },
    {
      orgName: BRAND.name,
      customerName: order.customer.name,
      orderNumber: String(order.orderNumber ?? ""),
      amount: formatCents(Math.abs(entry.amountCents)),
    },
    `refund|${entry.stripeRefundId}`,
    tx
  );
}
