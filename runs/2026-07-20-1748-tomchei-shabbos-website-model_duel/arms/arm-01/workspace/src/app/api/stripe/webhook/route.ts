import { PaymentIntentStatus, PaymentMethod, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { enqueueRefundEmail } from "@/domain/billing-notifications";
import {
  CheckoutConflictError,
  commitStripePayment,
  recalculatePaymentStatus,
} from "@/domain/checkout";
import { db } from "@/lib/db";
import { constructStripeEvent, getStripe } from "@/lib/stripe";

async function markSafetyRefund(
  eventId: string,
  orderId: string,
  paymentIntentId: string,
  conflicts: string[],
  eventType: string,
) {
  const stripe = getStripe();
  if (stripe && !paymentIntentId.startsWith("pi_local_")) {
    await stripe.refunds.create(
      { payment_intent: paymentIntentId, reason: "requested_by_customer" },
      { idempotencyKey: `safety-refund:${eventId}` },
    );
  }
  await db.$transaction(
    async (transaction) => {
      const priorEvent = await transaction.stripeWebhookEvent.findUnique({
        where: { id: eventId },
      });
      if (priorEvent) return;
      const activeIntent = await transaction.stripePaymentIntent.findFirst({
        where: {
          orderId,
          status: { in: [PaymentIntentStatus.CREATED, PaymentIntentStatus.PROCESSING] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (activeIntent) {
        await transaction.stripePaymentIntent.update({
          where: { id: activeIntent.id },
          data: {
            stripePaymentIntentId: paymentIntentId,
            status: PaymentIntentStatus.REFUNDED,
          },
        });
      }
      await transaction.order.update({
        where: { id: orderId },
        data: { cachedPaymentStatus: "REFUNDED" },
      });
      await transaction.auditLog.create({
        data: {
          action: "payment.safety_refunded",
          targetType: "Order",
          targetId: orderId,
          metadata: { stripeEventId: eventId, conflicts },
        },
      });
      await transaction.stripeWebhookEvent.create({
        data: { id: eventId, type: eventType },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function processCheckoutCompleted(event: Stripe.CheckoutSessionCompletedEvent) {
  const session = event.data.object;
  const orderId = session.metadata?.orderId;
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  const checkoutFingerprint = session.metadata?.checkoutFingerprint;
  if (
    !orderId ||
    !paymentIntentId ||
    session.amount_total === null ||
    !checkoutFingerprint
  ) {
    throw new Error("Stripe checkout event is missing order or payment details.");
  }
  if (session.payment_status !== "paid") {
    await db.$transaction([
      db.stripePaymentIntent.updateMany({
        where: { stripeCheckoutSessionId: session.id },
        data: { status: PaymentIntentStatus.PROCESSING },
      }),
      db.stripeWebhookEvent.create({ data: { id: event.id, type: event.type } }),
    ]);
    return { pending: true };
  }
  try {
    return await commitStripePayment(
      db,
      event.id,
      orderId,
      paymentIntentId,
      session.amount_total,
      checkoutFingerprint,
    );
  } catch (error) {
    if (!(error instanceof CheckoutConflictError)) throw error;
    await markSafetyRefund(event.id, orderId, paymentIntentId, error.conflicts, event.type);
    return { safetyRefunded: true };
  }
}

async function processRefund(event: Stripe.ChargeRefundedEvent) {
  const charge = event.data.object;
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!paymentIntentId) return;
  const storedIntent = await db.stripePaymentIntent.findUnique({
    where: { stripePaymentIntentId: paymentIntentId },
  });
  if (!storedIntent) return;
  await db.$transaction(
    async (transaction) => {
      const priorEvent = await transaction.stripeWebhookEvent.findUnique({
        where: { id: event.id },
      });
      if (priorEvent) return;
      const payment = await transaction.payment.findUnique({
        where: {
          method_reference: {
            method: PaymentMethod.STRIPE,
            reference: paymentIntentId,
          },
        },
      });
      if (!payment) {
        await transaction.stripeWebhookEvent.create({
          data: { id: event.id, type: event.type },
        });
        return;
      }
      const refundedCents = Math.min(
        payment.amountCents,
        charge.amount_refunded ?? charge.amount ?? payment.amountCents,
      );
      await transaction.payment.update({
        where: { id: payment.id },
        data: { refundedCents },
      });
      if (refundedCents >= payment.amountCents) {
        await transaction.stripePaymentIntent.update({
          where: { id: storedIntent.id },
          data: { status: PaymentIntentStatus.REFUNDED },
        });
      }
      await transaction.stripeWebhookEvent.create({
        data: { id: event.id, type: event.type },
      });
      await recalculatePaymentStatus(transaction, storedIntent.orderId);
      const order = await transaction.order.findUniqueOrThrow({
        where: { id: storedIntent.orderId },
        include: { customer: true },
      });
      const newlyRefundedCents = refundedCents - payment.refundedCents;
      if (newlyRefundedCents > 0) {
        await enqueueRefundEmail(
          transaction,
          order,
          payment,
          newlyRefundedCents,
        );
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Stripe signature is required." }, { status: 400 });
  }
  let event: Stripe.Event;
  try {
    event = constructStripeEvent(await request.text(), signature);
  } catch {
    return NextResponse.json({ error: "Stripe signature is invalid." }, { status: 400 });
  }

  const priorEvent = await db.stripeWebhookEvent.findUnique({ where: { id: event.id } });
  if (priorEvent) return NextResponse.json({ received: true, replayed: true });

  if (event.type === "checkout.session.completed") {
    const outcome = await processCheckoutCompleted(event);
    return NextResponse.json({ received: true, ...outcome });
  }
  if (event.type === "charge.refunded") {
    await processRefund(event);
    return NextResponse.json({ received: true });
  }
  if (event.type === "payment_intent.payment_failed") {
    const intent = event.data.object;
    await db.$transaction([
      db.stripePaymentIntent.updateMany({
        where: { stripePaymentIntentId: intent.id },
        data: { status: PaymentIntentStatus.FAILED },
      }),
      db.stripeWebhookEvent.create({ data: { id: event.id, type: event.type } }),
    ]);
    return NextResponse.json({ received: true });
  }

  await db.stripeWebhookEvent.create({ data: { id: event.id, type: event.type } });
  return NextResponse.json({ received: true });
}
