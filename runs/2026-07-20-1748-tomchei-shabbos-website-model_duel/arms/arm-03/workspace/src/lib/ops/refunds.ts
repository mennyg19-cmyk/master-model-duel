import {
  AuditAction,
  CachedPaymentStatus,
  PaymentMethod,
  PaymentState,
  type Payment,
  type Prisma,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { err, maskError, ok, type Result } from "@/lib/result";
import { getStripe, getStripeMode } from "@/lib/stripe/client";
import { recalcOrderPaymentStatus } from "@/lib/payments/offline";

type Tx = Prisma.TransactionClient;

async function lockPaymentForUpdate(tx: Tx, paymentId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new Error(`Payment ${paymentId} not found`);
  }
  return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
}

function refundIdempotencyKey(
  paymentId: string,
  baselineRefundedCents: number,
  amountCents: number,
): string {
  return createHash("sha256")
    .update(`refund:${paymentId}:${baselineRefundedCents}:${amountCents}`)
    .digest("hex")
    .slice(0, 32);
}

async function createStripeRefund(input: {
  payment: Payment;
  amountCents: number;
  staffId: string;
  idempotencyKey: string;
}): Promise<Result<string>> {
  const mode = getStripeMode();
  if (mode === "mock") {
    return ok(`re_mock_${input.idempotencyKey}`);
  }
  const stripe = getStripe();
  if (!stripe) {
    return err("stripe", "Stripe is not configured for refunds.");
  }
  const chargeOrPi = input.payment.stripeChargeId;
  if (!chargeOrPi) {
    return err("stripe", "Stripe payment missing charge/intent id.");
  }
  const refund = await stripe.refunds.create(
    {
      amount: input.amountCents,
      ...(chargeOrPi.startsWith("pi_")
        ? { payment_intent: chargeOrPi }
        : { charge: chargeOrPi }),
      reason: "requested_by_customer",
      metadata: {
        orderId: input.payment.orderId,
        paymentId: input.payment.id,
        staffId: input.staffId,
      },
    },
    { idempotencyKey: input.idempotencyKey },
  );
  return ok(refund.id);
}

async function compensateClaimedRefund(input: {
  paymentId: string;
  orderId: string;
  amountCents: number;
  staffId: string;
  reason: string;
}) {
  await db.$transaction(async (tx) => {
    await lockPaymentForUpdate(tx, input.paymentId);
    await tx.payment.update({
      where: { id: input.paymentId },
      data: { refundedCents: { decrement: input.amountCents } },
    });
    await tx.auditLog.create({
      data: {
        action: AuditAction.PAYMENT_REFUNDED,
        actorId: input.staffId,
        meta: {
          orderId: input.orderId,
          paymentId: input.paymentId,
          amountCents: input.amountCents,
          compensated: true,
          reason: input.reason,
        },
      },
    });
    await recalcOrderPaymentStatus(input.orderId, tx);
  });
}

/**
 * Refund path for cash/check + Stripe (R-053, R-054).
 * Claims the refund in DB first (row lock), then Stripe with Idempotency-Key;
 * compensates the DB claim if Stripe fails.
 */
export async function refundPayment(input: {
  paymentId: string;
  orderId: string;
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
    const existing = await db.payment.findUnique({ where: { id: input.paymentId } });
    if (!existing) {
      return err("missing", "Payment not found.");
    }
    // B1: ownership before any money path.
    if (existing.orderId !== input.orderId) {
      return err("order", "Payment does not belong to this order.");
    }
    if (existing.state !== PaymentState.POSTED) {
      return err("state", "Only posted payments can be refunded.");
    }
    const remaining = existing.amountCents - existing.refundedCents;
    if (input.amountCents > remaining) {
      return err(
        "amount",
        `Refund ${input.amountCents}¢ exceeds remaining ${remaining}¢.`,
      );
    }

    const baseline = existing.refundedCents;
    const idempotencyKey = refundIdempotencyKey(
      existing.id,
      baseline,
      input.amountCents,
    );

    // B2: claim in DB under row lock before Stripe.
    const claimed = await db.$transaction(async (tx) => {
      const locked = await lockPaymentForUpdate(tx, existing.id);
      if (locked.orderId !== input.orderId) {
        throw Object.assign(new Error("Payment does not belong to this order."), {
          code: "order",
        });
      }
      if (locked.state !== PaymentState.POSTED) {
        throw Object.assign(new Error("Only posted payments can be refunded."), {
          code: "state",
        });
      }
      if (locked.refundedCents !== baseline) {
        throw Object.assign(new Error("Refund conflict — payment changed."), {
          code: "conflict",
        });
      }
      const left = locked.amountCents - locked.refundedCents;
      if (input.amountCents > left) {
        throw Object.assign(
          new Error(`Refund ${input.amountCents}¢ exceeds remaining ${left}¢.`),
          { code: "amount" },
        );
      }

      const updated = await tx.payment.update({
        where: { id: locked.id },
        data: { refundedCents: { increment: input.amountCents } },
      });

      await tx.auditLog.create({
        data: {
          action: AuditAction.PAYMENT_REFUNDED,
          actorId: input.staffId,
          meta: {
            orderId: locked.orderId,
            paymentId: locked.id,
            amountCents: input.amountCents,
            method: locked.method,
            reason: input.reason ?? null,
            idempotencyKey,
            stripeRefundId: null,
            pendingStripe: locked.method === PaymentMethod.STRIPE,
          },
        },
      });

      const paymentStatus = await recalcOrderPaymentStatus(locked.orderId, tx);
      return { payment: updated, paymentStatus, method: locked.method };
    });

    let stripeRefundId: string | null = null;
    if (claimed.method === PaymentMethod.STRIPE) {
      try {
        const stripeResult = await createStripeRefund({
          payment: existing,
          amountCents: input.amountCents,
          staffId: input.staffId,
          idempotencyKey,
        });
        if (!stripeResult.ok) {
          await compensateClaimedRefund({
            paymentId: existing.id,
            orderId: input.orderId,
            amountCents: input.amountCents,
            staffId: input.staffId,
            reason: stripeResult.publicMessage,
          });
          return stripeResult;
        }
        stripeRefundId = stripeResult.value;
        await db.auditLog.create({
          data: {
            action: AuditAction.PAYMENT_REFUNDED,
            actorId: input.staffId,
            meta: {
              orderId: input.orderId,
              paymentId: existing.id,
              amountCents: input.amountCents,
              method: PaymentMethod.STRIPE,
              reason: input.reason ?? null,
              idempotencyKey,
              stripeRefundId,
              stripeConfirmed: true,
            },
          },
        });
      } catch (stripeError) {
        await compensateClaimedRefund({
          paymentId: existing.id,
          orderId: input.orderId,
          amountCents: input.amountCents,
          staffId: input.staffId,
          reason: maskError(stripeError),
        });
        return err(maskError(stripeError), "Could not refund payment.");
      }
    }

    return ok({
      payment: claimed.payment,
      paymentStatus: claimed.paymentStatus,
      stripeRefundId,
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : null;
    if (code === "order" || code === "state" || code === "amount" || code === "conflict") {
      return err(code, error instanceof Error ? error.message : "Refund rejected.");
    }
    return err(maskError(error), "Could not refund payment.");
  }
}
