import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { verifyWebhookSignature } from "@/lib/payments/webhook-verify";
import { getPaymentGateway } from "@/lib/payments/stripe";
import { postPayment, recordRefund } from "@/lib/payments/post-payment";
import { recalcPaymentStatus } from "@/lib/domain/payment-status";
import { finalizeOrder } from "@/lib/domain/finalize";

// Stripe webhook (R-125, R-167): authenticity by signature, idempotency by a
// unique event-id ledger. No same-origin guard — Stripe posts cross-origin;
// the signature IS the authentication.

const eventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

const completedSessionSchema = z.object({
  id: z.string().min(1),
  amount_total: z.number().int(),
  payment_intent: z.string().min(1).nullable().optional(),
});

const refundSchema = z.object({
  id: z.string().min(1),
  amount: z.number().int(),
  payment_intent: z.string().min(1).nullable().optional(),
});

export async function POST(request: Request) {
  const payload = await request.text();
  if (!verifyWebhookSignature(env.STRIPE_WEBHOOK_SECRET, payload, request.headers.get("stripe-signature"))) {
    return Response.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  const parsed = eventSchema.safeParse(JSON.parse(payload));
  if (!parsed.success) return Response.json({ error: "Malformed event" }, { status: 400 });
  const event = parsed.data;

  // Idempotency (R-167): the unique insert claims this event id. A replay hits
  // P2002 and is acknowledged without touching money or stock again.
  try {
    await db.stripeWebhookEvent.create({ data: { stripeEventId: event.id, type: event.type } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ received: true, replay: true });
    }
    throw error;
  }

  if (event.type === "checkout.session.completed") {
    const session = completedSessionSchema.safeParse(event.data.object);
    if (session.success) await handleSessionCompleted(session.data);
  } else if (event.type === "checkout.session.expired") {
    const session = completedSessionSchema.omit({ amount_total: true }).safeParse(event.data.object);
    if (session.success) {
      await db.stripeCheckoutSession.updateMany({
        where: { stripeSessionId: session.data.id, status: "open" },
        data: { status: "expired" },
      });
    }
  } else if (event.type === "refund.created" || event.type === "refund.updated") {
    const refund = refundSchema.safeParse(event.data.object);
    if (refund.success) await handleRefund(refund.data);
  }
  // Unknown event types are acknowledged — Stripe retries anything non-2xx.

  return Response.json({ received: true });
}

async function handleSessionCompleted(session: z.infer<typeof completedSessionSchema>) {
  const record = await db.stripeCheckoutSession.findUnique({
    where: { stripeSessionId: session.id },
    include: { order: true },
  });
  if (!record) {
    console.error(`[stripe] completed session ${session.id} has no local record — ignoring`);
    return;
  }

  await db.stripeCheckoutSession.update({
    where: { id: record.id },
    data: { paymentIntentId: session.payment_intent ?? null },
  });

  const paymentIntentId = session.payment_intent ?? `missing_intent_${session.id}`;

  // Charged-amount safety (R-126): the money Stripe took must match both what
  // we asked the session for and what the order still costs, and the order
  // must still be payable (not replaced by a retry, not discarded). Anything
  // off → the charge is refunded in full automatically (R-169).
  const safe =
    session.amount_total === record.amountCents &&
    session.amount_total === record.order.totalCents &&
    record.order.status === "DRAFT" &&
    record.status === "open";

  if (!safe) {
    await autoRefund(record.orderId, paymentIntentId, session.amount_total, "stale or mismatched checkout session");
    await db.stripeCheckoutSession.update({ where: { id: record.id }, data: { status: "auto_refunded" } });
    if (record.order.status === "DRAFT") {
      await db.order.update({
        where: { id: record.orderId },
        data: { status: "DISCARDED", discardedAt: new Date() },
      });
    }
    return;
  }

  await postPayment({
    orderId: record.orderId,
    method: "STRIPE",
    amountCents: session.amount_total,
    stripePaymentIntentId: paymentIntentId,
    note: `Checkout session ${session.id}`,
  });

  try {
    await finalizeOrder(record.orderId);
  } catch (error) {
    // Payment landed but stock ran out between checkout and webhook: refund in
    // full and discard so the customer is never charged for an unfillable order.
    console.error(`[stripe] finalize after payment failed for order ${record.orderId}:`, error);
    await autoRefund(record.orderId, paymentIntentId, session.amount_total, "stock ran out before finalize");
    await db.order.update({
      where: { id: record.orderId },
      data: { status: "DISCARDED", discardedAt: new Date() },
    });
    await db.stripeCheckoutSession.update({ where: { id: record.id }, data: { status: "auto_refunded" } });
    return;
  }

  await db.stripeCheckoutSession.update({ where: { id: record.id }, data: { status: "completed" } });

  // Guest-clear-on-success (R-022): the draft row completes here; the cookie
  // itself is dropped on the success page (webhooks have no browser cookies).
  if (record.order.sourceDraftId) {
    await db.orderDraft.updateMany({
      where: { id: record.order.sourceDraftId, status: "ACTIVE" },
      data: { status: "COMPLETED" },
    });
  }
}

async function handleRefund(refund: z.infer<typeof refundSchema>) {
  if (!refund.payment_intent) return;
  const payment = await db.payment.findFirst({
    where: { stripePaymentIntentId: refund.payment_intent, amountCents: { gt: 0 } },
  });
  if (!payment) {
    console.error(`[stripe] refund ${refund.id} references unknown payment intent ${refund.payment_intent}`);
    return;
  }
  // Refund sync (R-168): idempotent on the unique stripeRefundId.
  await recordRefund({
    orderId: payment.orderId,
    amountCents: refund.amount,
    stripeRefundId: refund.id,
    stripePaymentIntentId: refund.payment_intent,
    note: "Refund synced from Stripe",
  });
}

async function autoRefund(orderId: string, paymentIntentId: string, amountCents: number, reason: string) {
  const gateway = getPaymentGateway();
  try {
    const refund = await gateway.createRefund(paymentIntentId, amountCents);
    await db.$transaction(async (tx) => {
      // The charge existed at Stripe even though we refused it — record both
      // sides so the books match Stripe's: payment in, auto-refund out.
      await tx.payment.create({
        data: {
          orderId,
          method: "STRIPE",
          amountCents,
          stripePaymentIntentId: paymentIntentId,
          note: `Charge received then auto-refunded: ${reason}`,
        },
      });
      await tx.payment.create({
        data: {
          orderId,
          method: "STRIPE",
          amountCents: -amountCents,
          stripeRefundId: refund.refundId,
          stripePaymentIntentId: paymentIntentId,
          note: `Auto-refund: ${reason}`,
        },
      });
      await recalcPaymentStatus(tx, orderId);
    });
  } catch (error) {
    console.error(`[stripe] AUTO-REFUND FAILED for order ${orderId} (${reason}) — needs manual refund:`, error);
  }
}
