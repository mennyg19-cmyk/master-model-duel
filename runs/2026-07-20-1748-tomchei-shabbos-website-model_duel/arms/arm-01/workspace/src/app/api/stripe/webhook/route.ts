import { PaymentIntentStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
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
) {
  const stripe = getStripe();
  if (stripe && !paymentIntentId.startsWith("pi_local_")) {
    await stripe.refunds.create(
      { payment_intent: paymentIntentId, reason: "requested_by_customer" },
      { idempotencyKey: `safety-refund:${eventId}` },
    );
  }
  await db.$transaction([
    db.stripePaymentIntent.updateMany({
      where: { orderId },
      data: {
        stripePaymentIntentId: paymentIntentId,
        status: PaymentIntentStatus.REFUNDED,
      },
    }),
    db.order.update({
      where: { id: orderId },
      data: { cachedPaymentStatus: "REFUNDED" },
    }),
    db.auditLog.create({
      data: {
        action: "payment.safety_refunded",
        targetType: "Order",
        targetId: orderId,
        metadata: { stripeEventId: eventId, conflicts },
      },
    }),
    db.stripeWebhookEvent.create({
      data: { id: eventId, type: "checkout.session.completed" },
    }),
  ]);
}

async function processCheckoutCompleted(event: Stripe.CheckoutSessionCompletedEvent) {
  const session = event.data.object;
  const orderId = session.metadata?.orderId;
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!orderId || !paymentIntentId || session.amount_total === null) {
    throw new Error("Stripe checkout event is missing order or payment details.");
  }
  try {
    return await commitStripePayment(
      db,
      event.id,
      orderId,
      paymentIntentId,
      session.amount_total,
    );
  } catch (error) {
    if (!(error instanceof CheckoutConflictError)) throw error;
    await markSafetyRefund(event.id, orderId, paymentIntentId, error.conflicts);
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
  const intent = await db.stripePaymentIntent.findUnique({
    where: { stripePaymentIntentId: paymentIntentId },
  });
  if (!intent) return;
  await db.$transaction([
    db.stripePaymentIntent.update({
      where: { id: intent.id },
      data: { status: PaymentIntentStatus.REFUNDED },
    }),
    db.payment.updateMany({
      where: { orderId: intent.orderId, method: "STRIPE", reference: paymentIntentId },
      data: { status: "VOIDED", voidedAt: new Date() },
    }),
    db.stripeWebhookEvent.create({
      data: { id: event.id, type: event.type },
    }),
  ]);
  await recalculatePaymentStatus(db, intent.orderId);
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
