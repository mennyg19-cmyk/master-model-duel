import { Payment } from "@prisma/client";
import { prisma, reloadOrThrow } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { voidPaymentTx } from "@/lib/payments/post";
import { createRefund, getStripeConfig } from "@/lib/payments/stripe";
import { enqueueRefundEmailTx } from "@/lib/email/order-emails";

// R-054: admin-initiated refund of a posted card payment. The local VOIDED
// flip is evidence-gated: it happens only after Stripe confirms the money
// went back (this path) or reports that it did (the charge.refunded webhook).
// A keyless host can produce no such evidence, so the refund refuses with
// operator instructions instead of voiding locally — downstream views must
// never show a payment as returned while the card is still charged.
export interface RefundOutcome {
  payment: Payment;
  stripeRefundId: string;
}

export async function refundStripePayment(input: {
  paymentId: string;
  reason?: string;
  actor: { id: string; email: string };
}): Promise<RefundOutcome> {
  const payment = await prisma.payment.findUnique({ where: { id: input.paymentId } });
  if (!payment) throw new NotFoundError("Payment", input.paymentId);
  if (payment.method !== "STRIPE") {
    throw new DomainRuleError(`Payment ${input.paymentId} is ${payment.method}; only card payments refund through Stripe`);
  }
  if (payment.status !== "POSTED") {
    throw new DomainRuleError(`Payment ${input.paymentId} is ${payment.status}; expected POSTED to refund`);
  }
  if (!payment.externalRef) {
    throw new DomainRuleError(`Payment ${input.paymentId} has no Stripe reference; refund it manually in the dashboard`);
  }
  if (!getStripeConfig().secretKey) {
    throw new DomainRuleError(
      "Stripe is not configured on this host — refund the card in the Stripe dashboard; the local record voids itself when the refund webhook lands",
    );
  }

  // Idempotent at Stripe: refund-<paymentIntent> replays to the same refund.
  // The Stripe call must succeed BEFORE the local void — never the reverse.
  const refund = await createRefund(payment.externalRef);

  const updated = await prisma.$transaction(async (tx) => {
    const voided = await voidPaymentTx(tx, input.paymentId, input.reason ?? "Stripe refund");
    await tx.payment.update({ where: { id: input.paymentId }, data: { refundRef: refund.id } });
    // R-087: refund email commits in the same transaction as the void — the
    // customer is always told when money goes back.
    const order = await tx.order.findUniqueOrThrow({
      where: { id: voided.orderId },
      include: { customer: { select: { name: true, email: true } } },
    });
    await enqueueRefundEmailTx(tx, {
      order,
      customer: order.customer,
      amountCents: voided.amountCents,
      stripeRefundId: refund.id,
    });
    await recordAudit(
      {
        actor: input.actor,
        action: "payment_refund",
        targetType: "Payment",
        targetId: input.paymentId,
        metadata: {
          orderId: voided.orderId,
          amountCents: voided.amountCents,
          stripeRefundId: refund.id,
          reason: input.reason ?? null,
        },
      },
      tx,
    );
    return reloadOrThrow(() => tx.payment.findUnique({ where: { id: input.paymentId } }), "Payment", input.paymentId);
  });

  return { payment: updated, stripeRefundId: refund.id };
}
