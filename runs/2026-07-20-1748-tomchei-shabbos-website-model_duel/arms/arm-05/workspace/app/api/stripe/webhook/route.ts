import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { completeCheckout, isValidStripeSignature, refundSafetyPayment } from "@/lib/checkout";
import { prisma } from "@/lib/db";
import { queueOrderLifecycleEmail } from "@/lib/email";

type StripeEvent = {
  id?: string;
  type?: string;
  data?: { object?: { id?: string; payment_intent?: string } };
};

async function markRefunded(event: StripeEvent) {
  return prisma.$transaction(async (transaction) => {
    try {
      await transaction.webhookEvent.create({
        data: { provider: "stripe", externalId: event.id!, eventType: event.type! },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { replayed: true };
      throw error;
    }

    const intentId = event.type === "charge.refunded"
      ? event.data?.object?.payment_intent
      : event.data?.object?.id;
    if (!intentId) return { replayed: false };
    const intent = await transaction.stripePaymentIntent.findUnique({ where: { stripeIntentId: intentId } });
    if (!intent?.paymentId) return { replayed: false };
    await transaction.payment.update({ where: { id: intent.paymentId }, data: { status: "REFUNDED" } });
    await transaction.order.update({ where: { id: intent.orderId }, data: { paymentStatus: "REFUNDED" } });
    return { replayed: false, orderId: intent.orderId };
  });
}

export async function POST(request: Request) {
  const body = await request.text();
  if (!isValidStripeSignature(body, request.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }
  let event: StripeEvent;
  try {
    event = JSON.parse(body) as StripeEvent;
  } catch {
    return NextResponse.json({ error: "Invalid Stripe event." }, { status: 400 });
  }
  if (!event.id || !event.type) return NextResponse.json({ error: "Invalid Stripe event." }, { status: 400 });
  if (event.type === "checkout.session.completed") {
    const sessionId = event.data?.object?.id;
    if (!sessionId) return NextResponse.json({ error: "Missing checkout session ID." }, { status: 400 });
    const completed = await completeCheckout(sessionId, event.id);
    if (completed.refundNeeded) await refundSafetyPayment(completed.paymentIntentId ?? null);
    return NextResponse.json(completed);
  }
  if (event.type === "charge.refunded" || event.type === "payment_intent.canceled") {
    const refunded = await markRefunded(event);
    if (!refunded.replayed && refunded.orderId) await queueOrderLifecycleEmail(refunded.orderId, "REFUND");
    return NextResponse.json({ received: true, ...refunded });
  }
  await prisma.webhookEvent.upsert({
    where: { provider_externalId: { provider: "stripe", externalId: event.id } },
    create: { provider: "stripe", externalId: event.id, eventType: event.type },
    update: {},
  });
  return NextResponse.json({ received: true });
}
