import { Order, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { enqueueTriggeredEmail } from "@/lib/email/triggered";
import { recordAudit, AuditContextLike } from "@/lib/audit";
import { formatCents } from "@/lib/money";

// R-087: the three order-lifecycle emails. Confirmation and refund enqueue
// inside the domain transaction that causes them (finalize / Stripe refund),
// so the email can never be lost when the event commits; the payment link is
// a staff action on an unpaid FINALIZED order.

function orderLabel(order: Pick<Order, "wireFormat" | "draftRef" | "id">): string {
  return order.wireFormat ?? order.draftRef ?? order.id;
}

export async function enqueueOrderConfirmationTx(
  tx: Prisma.TransactionClient,
  order: Pick<Order, "id" | "wireFormat" | "draftRef" | "totalCents">,
  customer: { name: string; email: string },
): Promise<void> {
  await enqueueTriggeredEmail(
    {
      key: "order_confirmation",
      recipient: customer.email,
      tokens: {
        customerName: customer.name,
        orderRef: orderLabel(order),
        amount: formatCents(order.totalCents),
      },
      orderId: order.id,
    },
    tx,
  );
}

export async function enqueueRefundEmailTx(
  tx: Prisma.TransactionClient,
  input: {
    order: Pick<Order, "id" | "wireFormat" | "draftRef">;
    customer: { name: string; email: string };
    amountCents: number;
    stripeRefundId: string;
  },
): Promise<void> {
  await enqueueTriggeredEmail(
    {
      key: "refund_issued",
      recipient: input.customer.email,
      tokens: {
        customerName: input.customer.name,
        orderRef: orderLabel(input.order),
        amount: formatCents(input.amountCents),
      },
      orderId: input.order.id,
      metadata: { stripeRefundId: input.stripeRefundId },
    },
    tx,
  );
}

// Staff action: email the customer a link to their order page (the pay entry
// for drafts; the balance view for finalized orders). Only meaningful while a
// balance is outstanding — the check keeps the email honest.
export async function sendPaymentLinkEmail(input: {
  orderId: string;
  payBaseUrl: string;
  ctx: AuditContextLike;
}): Promise<{ outboxId: string | null; suppressed: boolean }> {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: {
      customer: { select: { name: true, email: true } },
      payments: { where: { status: "POSTED" }, select: { amountCents: true } },
    },
  });
  if (!order) throw new NotFoundError("Order", input.orderId);
  if (order.status !== "FINALIZED") {
    throw new DomainRuleError(`Order ${input.orderId} is ${order.status}; expected FINALIZED to email a payment link`);
  }
  const paidCents = order.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const outstandingCents = order.totalCents - paidCents;
  if (outstandingCents <= 0) {
    throw new DomainRuleError(`Order ${orderLabel(order)} is fully paid; expected an outstanding balance to email a payment link`);
  }

  const result = await enqueueTriggeredEmail({
    key: "payment_link",
    recipient: order.customer.email,
    tokens: {
      customerName: order.customer.name,
      orderRef: orderLabel(order),
      amount: formatCents(outstandingCents),
      payUrl: `${input.payBaseUrl}/account/orders/${order.id}`,
    },
    orderId: order.id,
    metadata: { outstandingCents },
  });

  await recordAudit({
    ctx: input.ctx,
    action: "payment_link_email",
    targetType: "Order",
    targetId: order.id,
    metadata: {
      orderLabel: orderLabel(order),
      outstandingCents,
      result: result.status,
    },
  });
  return { outboxId: result.status === "queued" ? result.outboxId : null, suppressed: result.status === "disabled" };
}
