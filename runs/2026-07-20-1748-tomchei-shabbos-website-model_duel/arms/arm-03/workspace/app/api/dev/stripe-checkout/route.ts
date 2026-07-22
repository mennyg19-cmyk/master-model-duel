import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getCustomerContext } from "@/lib/auth/customer-session";
import { readSession } from "@/lib/auth/session";
import { getPaymentGateway } from "@/lib/payments/stripe";
import { signWebhookPayload } from "@/lib/payments/webhook-verify";
import { guardPublicEndpoint } from "@/lib/public-guard";

const paySchema = z.object({
  sessionId: z.string().min(1),
  // Test hook: override the "charged" amount to exercise the charged-amount
  // safety check + auto-refund path (R-126/R-169) without a real Stripe account.
  // Staff session required — unauthenticated callers cannot mint arbitrary amounts.
  amountCents: z.number().int().min(1).optional(),
});

/**
 * Mock-gateway "hosted checkout" pay action. Builds the same
 * checkout.session.completed event Stripe would send, signs it with the
 * webhook secret, and posts it through the REAL webhook route — signature
 * verification, idempotency, and the money path are exercised for real.
 * Refuses to exist when a live Stripe key is configured.
 */
export async function POST(request: Request) {
  if (getPaymentGateway().mode !== "mock") {
    return Response.json({ error: "Mock checkout is disabled when Stripe is configured" }, { status: 404 });
  }

  const blocked = guardPublicEndpoint(request, "mock-stripe-pay", 30, 60_000);
  if (blocked) return blocked;

  const parsed = paySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid pay request" }, { status: 400 });

  const session = await db.stripeCheckoutSession.findUnique({
    where: { stripeSessionId: parsed.data.sessionId },
    include: { order: { select: { customerId: true } } },
  });
  if (!session) return Response.json({ error: "Unknown checkout session" }, { status: 404 });

  const [customer, staff] = await Promise.all([getCustomerContext(), readSession()]);
  if (parsed.data.amountCents !== undefined && !staff) {
    return Response.json({ error: "amountCents override requires a staff session" }, { status: 403 });
  }
  if (customer && customer.id !== session.order.customerId) {
    return Response.json({ error: "This checkout belongs to a different customer" }, { status: 403 });
  }

  const event = {
    id: `evt_mock_${randomBytes(12).toString("hex")}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: session.stripeSessionId,
        amount_total: parsed.data.amountCents ?? session.amountCents,
        payment_intent: `pi_mock_${randomBytes(12).toString("hex")}`,
      },
    },
  };
  const payload = JSON.stringify(event);
  const signature = signWebhookPayload(env.STRIPE_WEBHOOK_SECRET, payload);

  const webhookResponse = await fetch(`${env.APP_URL}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": signature },
    body: payload,
  });
  if (!webhookResponse.ok) {
    return Response.json({ error: "Webhook delivery failed" }, { status: 502 });
  }

  // payload + signature come back so tests can replay the EXACT event and
  // prove webhook idempotency (a second click would mint a new event id).
  return Response.json({ ok: true, eventId: event.id, payload, signature });
}
