import { PaymentIntentStatus, PaymentMethod } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { recalculatePaymentStatus } from "@/domain/checkout";
import { enqueueTransactionalEmail } from "@/domain/messaging";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

const refundSchema = z.object({
  paymentId: z.string().min(1),
  amountCents: z.number().int().positive(),
  reason: z.string().trim().min(2).max(240),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  try {
    const session = await requirePermission("payments:manage");
    const parsed = refundSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Payment, positive amount, and reason are required." }, { status: 400 });
    }
    const { orderId } = await context.params;
    const payment = await db.payment.findFirst({
      where: { id: parsed.data.paymentId, orderId, status: "POSTED" },
    });
    const refundableCents = payment ? payment.amountCents - payment.refundedCents : 0;
    if (!payment || parsed.data.amountCents > refundableCents) {
      return NextResponse.json({ error: "Refund exceeds the remaining posted payment." }, { status: 409 });
    }

    const stripe = getStripe();
    const stripePaymentIntentId =
      payment.method === PaymentMethod.STRIPE ? payment.reference : null;
    const isStripePayment = Boolean(stripePaymentIntentId);
    const isLocalPayment = stripePaymentIntentId?.startsWith("pi_local_") ?? false;
    if (isStripePayment && !stripe && !isLocalPayment) {
      return NextResponse.json({ error: "Stripe is unavailable; no refund was recorded." }, { status: 503 });
    }

    const outcome = await db.$transaction(async (transaction) => {
      const updated = await transaction.payment.updateMany({
        where: { id: payment.id, refundedCents: payment.refundedCents },
        data: { refundedCents: { increment: parsed.data.amountCents } },
      });
      if (updated.count !== 1) return null;
      if (isStripePayment && stripe && !isLocalPayment) {
        await stripe.refunds.create(
          {
            payment_intent: stripePaymentIntentId!,
            amount: parsed.data.amountCents,
            reason: "requested_by_customer",
            metadata: { orderId, staffReason: parsed.data.reason },
          },
          {
            idempotencyKey: `admin-refund:${payment.id}:${
              parsed.data.idempotencyKey ??
              `${payment.refundedCents}:${parsed.data.amountCents}`
            }`,
          },
        );
      }
      if (
        isStripePayment &&
        payment.refundedCents + parsed.data.amountCents === payment.amountCents
      ) {
        await transaction.stripePaymentIntent.updateMany({
          where: { orderId, stripePaymentIntentId: stripePaymentIntentId! },
          data: { status: PaymentIntentStatus.REFUNDED },
        });
      }
      await transaction.auditLog.create({
        data: {
          actorStaffId: session.actor.id,
          action: "payment.refunded",
          targetType: "Payment",
          targetId: payment.id,
          metadata: { orderId, amountCents: parsed.data.amountCents, reason: parsed.data.reason },
        },
      });
      const cachedPaymentStatus = await recalculatePaymentStatus(transaction, orderId);
      const order = await transaction.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { customer: true },
      });
      await enqueueTransactionalEmail(transaction, {
        idempotencyKey: `refund:${payment.id}:${payment.refundedCents}:${parsed.data.amountCents}`,
        templateKey: "order.refund",
        recipient: order.customer.email,
        variables: {
          orderNumber: order.orderNumber ?? order.draftReference,
          refundAmount: `$${(parsed.data.amountCents / 100).toFixed(2)}`,
        },
        customerId: order.customer.id,
        orderId,
      });
      return { cachedPaymentStatus };
    });
    if (!outcome) {
      return NextResponse.json({ error: "Payment changed before refund; reload and try again." }, { status: 409 });
    }
    return NextResponse.json(outcome);
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
