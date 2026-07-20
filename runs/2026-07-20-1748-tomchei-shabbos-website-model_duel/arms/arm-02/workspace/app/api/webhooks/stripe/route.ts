import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { verifyWebhookSignature } from "@/lib/payments/webhook-verify";
import { getPaymentGateway } from "@/lib/payments/stripe";
import { postPayment, recordRefund } from "@/lib/payments/post-payment";
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

// Refund object as embedded in charge.refunded's refunds list or delivered as
// the charge.refund.updated payload (Stripe emits charge.* refund events;
// refund.* are object names, not event types — R-168).
const refundObjectSchema = z.object({
  id: z.string().min(1),
  amount: z.number().int(),
  payment_intent: z.string().min(1).nullable().optional(),
  status: z.string().nullable().optional(),
});

const refundedChargeSchema = z.object({
  id: z.string().min(1),
  payment_intent: z.string().min(1).nullable().optional(),
  amount_refunded: z.number().int(),
  // Newer Stripe API versions omit the embedded list unless expanded.
  refunds: z.object({ data: z.array(refundObjectSchema) }).optional(),
});

export async function POST(request: Request) {
  const payload = await request.text();
  if (!verifyWebhookSignature(env.STRIPE_WEBHOOK_SECRET, payload, request.headers.get("stripe-signature"))) {
    return Response.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  const parsed = eventSchema.safeParse(JSON.parse(payload));
  if (!parsed.success) return Response.json({ error: "Malformed event" }, { status: 400 });
  const event = parsed.data;

  // Idempotency (R-167), pending → processed: the unique insert claims this
  // event id with status "pending"; the flip to "processed" happens only after
  // the money work below succeeds. A replay of a processed event is a no-op.
  // A redelivery of a still-pending event (crash mid-work, 5xx retry) falls
  // through and reprocesses — every handler below is retry-safe, so the
  // original event is never permanently lost.
  try {
    await db.stripeWebhookEvent.create({ data: { stripeEventId: event.id, type: event.type } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const claimed = await db.stripeWebhookEvent.findUnique({ where: { stripeEventId: event.id } });
      if (!claimed || claimed.status === "processed") {
        return Response.json({ received: true, replay: true });
      }
    } else {
      throw error;
    }
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
  } else if (event.type === "charge.refunded") {
    const charge = refundedChargeSchema.safeParse(event.data.object);
    if (charge.success) await handleChargeRefunded(charge.data);
  } else if (event.type === "charge.refund.updated") {
    const refund = refundObjectSchema.safeParse(event.data.object);
    if (refund.success && refund.data.status === "succeeded") await handleRefund(refund.data);
  }
  // Unknown event types are acknowledged — Stripe retries anything non-2xx.

  await db.stripeWebhookEvent.update({
    where: { stripeEventId: event.id },
    data: { status: "processed", processedAt: new Date() },
  });

  return Response.json({ received: true });
}

async function handleSessionCompleted(session: z.infer<typeof completedSessionSchema>) {
  const sessionRecord = await db.stripeCheckoutSession.findUnique({
    where: { stripeSessionId: session.id },
    include: { order: true },
  });
  if (!sessionRecord) {
    console.error(`[stripe] completed session ${session.id} has no local record — ignoring`);
    return;
  }

  await db.stripeCheckoutSession.update({
    where: { id: sessionRecord.id },
    data: { paymentIntentId: session.payment_intent ?? null },
  });

  const paymentIntentId = session.payment_intent ?? `missing_intent_${session.id}`;

  // Retry-safety: a redelivery of a pending event may arrive after part of the
  // work already committed; the posted charge row is the durable marker.
  const priorCharge = await db.payment.findFirst({
    where: { orderId: sessionRecord.orderId, stripePaymentIntentId: paymentIntentId, amountCents: { gt: 0 }, state: "POSTED" },
  });
  const isRetry = priorCharge !== null;

  // Charged-amount safety (R-126): the money Stripe took must match both what
  // we asked the session for and what the order still costs, and the order
  // must still be payable (not replaced by a retry, not discarded). A retry of
  // partially-completed work is also safe: order FINALIZED / session completed
  // are legitimate mid-flight states when this exact charge is already booked.
  // Anything else off → the charge is refunded in full automatically (R-169).
  const chargeSafe =
    session.amount_total === sessionRecord.amountCents &&
    session.amount_total === sessionRecord.order.totalCents &&
    (sessionRecord.order.status === "DRAFT" || (isRetry && sessionRecord.order.status === "FINALIZED")) &&
    (sessionRecord.status === "open" || (isRetry && sessionRecord.status === "completed"));

  if (!chargeSafe) {
    const refunded = await autoRefund(sessionRecord.orderId, paymentIntentId, session.amount_total, {
      reason: "stale or mismatched checkout session",
      chargeAlreadyRecorded: isRetry,
    });
    // Only claim auto_refunded when the refund actually reached the gateway;
    // otherwise flag for manual reconciliation and leave the order untouched.
    await db.stripeCheckoutSession.update({
      where: { id: sessionRecord.id },
      data: { status: refunded ? "auto_refunded" : "refund_failed" },
    });
    if (refunded && sessionRecord.order.status === "DRAFT") {
      await db.order.update({
        where: { id: sessionRecord.orderId },
        data: { status: "DISCARDED", discardedAt: new Date() },
      });
    }
    return;
  }

  if (!isRetry) {
    await postPayment({
      orderId: sessionRecord.orderId,
      method: "STRIPE",
      amountCents: session.amount_total,
      stripePaymentIntentId: paymentIntentId,
      note: `Checkout session ${session.id}`,
    });
  }

  if (sessionRecord.order.status === "DRAFT") {
    try {
      await finalizeOrder(sessionRecord.orderId);
    } catch (error) {
      // Payment landed but stock ran out between checkout and webhook: refund in
      // full and discard so the customer is never charged for an unfillable order.
      // The charge row above already booked this payment — autoRefund must NOT
      // book it again (one Stripe charge, one positive ledger row).
      console.error(`[stripe] finalize after payment failed for order ${sessionRecord.orderId}:`, error);
      const refunded = await autoRefund(sessionRecord.orderId, paymentIntentId, session.amount_total, {
        reason: "stock ran out before finalize",
        chargeAlreadyRecorded: true,
      });
      if (refunded) {
        await db.order.update({
          where: { id: sessionRecord.orderId },
          data: { status: "DISCARDED", discardedAt: new Date() },
        });
        await db.stripeCheckoutSession.update({ where: { id: sessionRecord.id }, data: { status: "auto_refunded" } });
      } else {
        // Refund never reached Stripe: keep the order DRAFT for ops to resolve
        // and mark the session so the failure is visible, not just a log line.
        await db.stripeCheckoutSession.update({ where: { id: sessionRecord.id }, data: { status: "refund_failed" } });
      }
      return;
    }
  }

  await db.stripeCheckoutSession.update({ where: { id: sessionRecord.id }, data: { status: "completed" } });

  // Guest-clear-on-success (R-022): the draft row completes here; the cookie
  // itself is dropped on the success page (webhooks have no browser cookies).
  if (sessionRecord.order.sourceDraftId) {
    await db.orderDraft.updateMany({
      where: { id: sessionRecord.order.sourceDraftId, status: "ACTIVE" },
      data: { status: "COMPLETED" },
    });
  }
}

// Dashboard/external refunds arrive as charge.refunded with the charge as the
// event object. Sync every succeeded refund from the embedded list when Stripe
// includes it; otherwise book the cumulative delta under a deterministic key
// so replays stay idempotent (R-168).
async function handleChargeRefunded(charge: z.infer<typeof refundedChargeSchema>) {
  if (!charge.payment_intent) return;
  const payment = await db.payment.findFirst({
    where: { stripePaymentIntentId: charge.payment_intent, amountCents: { gt: 0 } },
  });
  if (!payment) {
    console.error(`[stripe] charge.refunded ${charge.id} references unknown payment intent ${charge.payment_intent}`);
    return;
  }

  const succeededRefunds = charge.refunds?.data.filter((refund) => !refund.status || refund.status === "succeeded") ?? [];
  if (succeededRefunds.length > 0) {
    for (const refund of succeededRefunds) {
      await recordRefund({
        orderId: payment.orderId,
        amountCents: refund.amount,
        stripeRefundId: refund.id,
        stripePaymentIntentId: charge.payment_intent,
        note: "Refund synced from Stripe",
      });
    }
    return;
  }

  const booked = await db.payment.aggregate({
    where: { stripePaymentIntentId: charge.payment_intent, amountCents: { lt: 0 }, state: "POSTED" },
    _sum: { amountCents: true },
  });
  const deltaCents = charge.amount_refunded + (booked._sum.amountCents ?? 0);
  if (deltaCents <= 0) return;
  await recordRefund({
    orderId: payment.orderId,
    amountCents: deltaCents,
    stripeRefundId: `${charge.id}:refunded:${charge.amount_refunded}`,
    stripePaymentIntentId: charge.payment_intent,
    note: "Refund synced from Stripe (charge.refunded)",
  });
}

async function handleRefund(refund: z.infer<typeof refundObjectSchema>) {
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

/**
 * Refunds an unwanted charge in full. Books the positive charge row first
 * (unless the normal payment path already did) so the ledger matches Stripe
 * 1:1 even when the refund then fails. Returns whether the refund reached the
 * gateway — callers must not mark anything auto_refunded on false.
 */
async function autoRefund(
  orderId: string,
  paymentIntentId: string,
  amountCents: number,
  opts: { reason: string; chargeAlreadyRecorded: boolean }
): Promise<boolean> {
  // Retry-safety: a prior delivery may have completed the refund already.
  const priorRefund = await db.payment.findFirst({
    where: { orderId, stripePaymentIntentId: paymentIntentId, amountCents: { lt: 0 }, state: "POSTED" },
  });
  if (priorRefund) return true;

  if (!opts.chargeAlreadyRecorded) {
    // The charge existed at Stripe even though we refused it — record it so
    // the books match Stripe's: payment in, auto-refund out.
    await postPayment({
      orderId,
      method: "STRIPE",
      amountCents,
      stripePaymentIntentId: paymentIntentId,
      note: `Charge received then auto-refunded: ${opts.reason}`,
    });
  }

  const gateway = getPaymentGateway();
  try {
    const refund = await gateway.createRefund(paymentIntentId, amountCents);
    await recordRefund({
      orderId,
      amountCents,
      stripeRefundId: refund.refundId,
      stripePaymentIntentId: paymentIntentId,
      note: `Auto-refund: ${opts.reason}`,
    });
    return true;
  } catch (error) {
    console.error(`[stripe] AUTO-REFUND FAILED for order ${orderId} (${opts.reason}) — needs manual refund:`, error);
    return false;
  }
}
