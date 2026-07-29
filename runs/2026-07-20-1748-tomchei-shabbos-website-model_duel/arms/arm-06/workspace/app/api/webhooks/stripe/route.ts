import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  chargeRefundedObjectSchema,
  checkoutSessionObjectSchema,
  completeCheckoutSession,
  expireCheckoutSession,
  syncChargeRefunded,
} from "@/lib/checkout/webhook";
import { getStripeConfig, verifyWebhookSignature } from "@/lib/payments/stripe";

export const dynamic = "force-dynamic";

const stripeEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  data: z.object({ object: z.unknown() }),
});

// R-125/R-167/R-168/R-169: Stripe webhook. Authenticity = v1 HMAC over the
// RAW body with a replay window; shape = zod parse of the envelope and the
// per-type object (a signed but malformed payload is a 400, never an unsafe
// cast); idempotency = one StripeWebhookEvent row per event id, so a replay
// is a no-op before any domain work runs. Failures delete the idempotency row
// and 500 so Stripe retries.
export async function POST(request: Request) {
  const { webhookSecret } = getStripeConfig();
  if (!webhookSecret) {
    return NextResponse.json({ error: "Stripe webhook is not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  if (!verifyWebhookSignature(rawBody, request.headers.get("stripe-signature"), webhookSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Malformed event body" }, { status: 400 });
  }
  const parsedEvent = stripeEventSchema.safeParse(json);
  if (!parsedEvent.success) {
    return NextResponse.json({ error: "Malformed event envelope" }, { status: 400 });
  }
  const event = parsedEvent.data;

  let sessionObject: z.infer<typeof checkoutSessionObjectSchema> | null = null;
  let chargeObject: z.infer<typeof chargeRefundedObjectSchema> | null = null;
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.expired") {
    const parsedObject = checkoutSessionObjectSchema.safeParse(event.data.object);
    if (!parsedObject.success) {
      return NextResponse.json({ error: `Malformed ${event.type} payload` }, { status: 400 });
    }
    sessionObject = parsedObject.data;
  } else if (event.type === "charge.refunded") {
    const parsedObject = chargeRefundedObjectSchema.safeParse(event.data.object);
    if (!parsedObject.success) {
      return NextResponse.json({ error: "Malformed charge.refunded payload" }, { status: 400 });
    }
    chargeObject = parsedObject.data;
  }

  try {
    await prisma.stripeWebhookEvent.create({ data: { eventId: event.id, type: event.type } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    throw error;
  }

  try {
    let orderId: string | undefined;
    let outcome = "ignored";
    if (event.type === "checkout.session.completed" && sessionObject) {
      const result = await completeCheckoutSession(sessionObject);
      outcome = result.outcome;
      orderId = result.orderId;
    } else if (event.type === "checkout.session.expired" && sessionObject) {
      const released = await expireCheckoutSession(sessionObject);
      outcome = released ? "released" : "ignored";
    } else if (event.type === "charge.refunded" && chargeObject) {
      const result = await syncChargeRefunded(chargeObject);
      outcome = result.voided ? "voided" : "ignored";
    }
    if (orderId) {
      await prisma.stripeWebhookEvent.updateMany({ where: { eventId: event.id }, data: { orderId } });
    }
    return NextResponse.json({ ok: true, outcome });
  } catch (error) {
    // Let Stripe redeliver: the next attempt re-runs as if this one never
    // happened (all domain writes above roll back on their own failures).
    await prisma.stripeWebhookEvent.deleteMany({ where: { eventId: event.id } });
    console.error(`stripe webhook ${event.type} (${event.id}) failed`, error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
