import {
  AuditAction,
  CachedPaymentStatus,
  PaymentMethod,
  PaymentState,
  type Payment,
} from "@prisma/client";
import { db } from "@/lib/db";
import { err, maskError, ok, type Result } from "@/lib/result";
import { getStripe, getStripeMode } from "@/lib/stripe/client";
import { recalcOrderPaymentStatus } from "@/lib/payments/offline";

/** Refund path for cash/check + Stripe (R-053, R-054). Mock Stripe when STRIPE_MODE=mock. */
export async function refundPayment(input: {
  paymentId: string;
  amountCents: number;
  staffId: string;
  reason?: string | null;
}): Promise<
  Result<{
    payment: Payment;
    paymentStatus: CachedPaymentStatus;
    stripeRefundId: string | null;
  }>
> {
  if (input.amountCents <= 0) {
    return err("amount", "Refund amount must be positive.");
  }

  try {
    const payment = await db.payment.findUniqueOrThrow({
      where: { id: input.paymentId },
    });
    if (payment.state !== PaymentState.POSTED) {
      return err("state", "Only posted payments can be refunded.");
    }
    const remaining = payment.amountCents - payment.refundedCents;
    if (input.amountCents > remaining) {
      return err(
        "amount",
        `Refund ${input.amountCents}¢ exceeds remaining ${remaining}¢.`,
      );
    }

    let stripeRefundId: string | null = null;

    if (payment.method === PaymentMethod.STRIPE) {
      const mode = getStripeMode();
      if (mode === "mock") {
        stripeRefundId = `re_mock_${payment.id.slice(0, 10)}_${input.amountCents}`;
      } else {
        const stripe = getStripe();
        if (!stripe) {
          return err("stripe", "Stripe is not configured for refunds.");
        }
        const chargeOrPi = payment.stripeChargeId;
        if (!chargeOrPi) {
          return err("stripe", "Stripe payment missing charge/intent id.");
        }
        const refund = await stripe.refunds.create({
          amount: input.amountCents,
          ...(chargeOrPi.startsWith("pi_")
            ? { payment_intent: chargeOrPi }
            : { charge: chargeOrPi }),
          reason: "requested_by_customer",
          metadata: {
            orderId: payment.orderId,
            paymentId: payment.id,
            staffId: input.staffId,
          },
        });
        stripeRefundId = refund.id;
      }
    }

    const result = await db.$transaction(async (tx) => {
      const updated = await tx.payment.update({
        where: { id: payment.id },
        data: { refundedCents: { increment: input.amountCents } },
      });

      await tx.auditLog.create({
        data: {
          action: AuditAction.PAYMENT_REFUNDED,
          actorId: input.staffId,
          meta: {
            orderId: payment.orderId,
            paymentId: payment.id,
            amountCents: input.amountCents,
            method: payment.method,
            reason: input.reason ?? null,
            stripeRefundId,
          },
        },
      });

      const paymentStatus = await recalcOrderPaymentStatus(payment.orderId, tx);
      return { payment: updated, paymentStatus, stripeRefundId };
    });

    return ok(result);
  } catch (error) {
    return err(maskError(error), "Could not refund payment.");
  }
}
