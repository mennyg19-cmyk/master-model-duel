import {
  AuditAction,
  CachedPaymentStatus,
  OrderStatus,
  PaymentMethod,
  PaymentState,
  Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";
import { finalizeOrder } from "@/lib/orders/finalize";
import { assertOrderTransition } from "@/lib/orders/state-machine";
import { recalcOrderPaymentStatus } from "@/lib/payments/offline";
import {
  getStripe,
  getStripeMode,
  mintMockEventId,
  mintMockPaymentIntentId,
  verifyWebhookSignature,
} from "@/lib/stripe/client";
import { err, maskError, ok, type Result } from "@/lib/result";

type CheckoutCompletedObject = {
  id: string;
  amount_total: number | null;
  payment_intent: string | null;
  metadata?: Record<string, string> | null;
  payment_status?: string | null;
};

type RefundObject = {
  id: string;
  amount: number;
  payment_intent: string | null;
  status: string;
};

type WebhookEventMeta = {
  type: string;
  status: "processing" | "processed";
};

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

/**
 * Claim a Stripe event for processing.
 * - true: we own this attempt (new claim or reclaim of unfinished processing)
 * - false: already processed (idempotent replay → HTTP 200)
 * - throws: transient DB errors (caller returns 500 so Stripe retries)
 */
async function claimWebhookEvent(
  eventId: string,
  type: string,
): Promise<boolean> {
  const meta: WebhookEventMeta = { type, status: "processing" };
  try {
    await db.stripeWebhookEvent.create({
      data: { eventId, type, meta },
    });
    return true;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await db.stripeWebhookEvent.findUnique({ where: { eventId } });
    if (!existing) throw error;
    const existingMeta = existing.meta as WebhookEventMeta | null;
    if (existingMeta?.status === "processed") return false;
    // Claimed but not finished — allow retry to re-run handlers.
    await db.stripeWebhookEvent.update({
      where: { eventId },
      data: { meta: { type, status: "processing" } satisfies WebhookEventMeta },
    });
    return true;
  }
}

async function markWebhookEventProcessed(eventId: string, type: string): Promise<void> {
  await db.stripeWebhookEvent.update({
    where: { eventId },
    data: {
      processedAt: new Date(),
      meta: { type, status: "processed" } satisfies WebhookEventMeta,
    },
  });
}

async function safetyRefund(input: {
  orderId: string;
  amountCents: number;
  paymentIntentId: string;
  reason: string;
}): Promise<void> {
  const mode = getStripeMode();
  let refundId = `re_mock_${input.paymentIntentId}`;
  if (mode !== "mock") {
    const stripe = getStripe();
    if (stripe && input.paymentIntentId) {
      const refund = await stripe.refunds.create({
        payment_intent: input.paymentIntentId,
        amount: input.amountCents,
      });
      refundId = refund.id;
    }
  }

  await db.payment.create({
    data: {
      orderId: input.orderId,
      method: PaymentMethod.STRIPE,
      state: PaymentState.POSTED,
      amountCents: 0,
      refundedCents: input.amountCents,
      reference: refundId,
      stripeChargeId: input.paymentIntentId,
    },
  });

  await db.auditLog.create({
    data: {
      action: AuditAction.SAFETY_REFUND,
      meta: {
        orderId: input.orderId,
        amountCents: input.amountCents,
        reason: input.reason,
        refundId,
        paymentIntentId: input.paymentIntentId,
      },
    },
  });
}

async function handleCheckoutSessionCompleted(
  session: CheckoutCompletedObject,
): Promise<Result<{ orderId: string; replay: boolean }>> {
  const orderId = session.metadata?.orderId;
  if (!orderId) return err("meta", "Checkout session missing orderId metadata.");

  const sessionRow = await db.stripeCheckoutSession.findUnique({
    where: { stripeSessionId: session.id },
  });
  if (!sessionRow) return err("session", "Unknown checkout session.");

  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { payments: true },
  });

  const charged = session.amount_total ?? 0;
  const expected = order.expectedTotalCents ?? sessionRow.amountCents;

  // Charged-amount safety (R-126): mismatch → auto-refund, do not finalize/commit.
  if (charged !== expected) {
    const pi = session.payment_intent ?? mintMockPaymentIntentId();
    await safetyRefund({
      orderId,
      amountCents: charged,
      paymentIntentId: typeof pi === "string" ? pi : String(pi),
      reason: `Charged ${charged}¢ but expected ${expected}¢`,
    });
    await db.stripeCheckoutSession.update({
      where: { id: sessionRow.id },
      data: { status: "safety_refunded" },
    });
    return ok({ orderId, replay: false });
  }

  // Already paid (idempotent replay)
  const existingStripe = order.payments.find(
    (p) =>
      p.method === PaymentMethod.STRIPE &&
      p.state === PaymentState.POSTED &&
      p.amountCents === charged,
  );
  if (existingStripe && order.status !== OrderStatus.DRAFT) {
    await db.stripeCheckoutSession.update({
      where: { id: sessionRow.id },
      data: { status: "complete" },
    });
    return ok({ orderId, replay: true });
  }

  if (order.status === OrderStatus.DRAFT) {
    const finalized = await finalizeOrder(orderId, null);
    if (!finalized.ok) {
      const pi = session.payment_intent ?? mintMockPaymentIntentId();
      await safetyRefund({
        orderId,
        amountCents: charged,
        paymentIntentId: typeof pi === "string" ? pi : String(pi),
        reason: `Finalize failed: ${finalized.publicMessage}`,
      });
      return err(finalized.error, finalized.publicMessage);
    }
  }

  const paymentIntentId =
    (typeof session.payment_intent === "string"
      ? session.payment_intent
      : null) ?? mintMockPaymentIntentId();

  await db.$transaction(async (tx) => {
    const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });

    await tx.payment.create({
      data: {
        orderId,
        method: PaymentMethod.STRIPE,
        state: PaymentState.POSTED,
        amountCents: charged,
        reference: session.id,
        stripeChargeId: paymentIntentId,
      },
    });

    await tx.stripePaymentIntent.upsert({
      where: { stripePaymentIntentId: paymentIntentId },
      create: {
        orderId,
        stripePaymentIntentId: paymentIntentId,
        status: "succeeded",
        amountCents: charged,
      },
      update: { status: "succeeded", amountCents: charged },
    });

    await tx.stripeCheckoutSession.update({
      where: { id: sessionRow.id },
      data: { status: "complete" },
    });

    await tx.auditLog.create({
      data: {
        action: AuditAction.PAYMENT_POSTED,
        meta: {
          orderId,
          method: PaymentMethod.STRIPE,
          amountCents: charged,
          sessionId: session.id,
        },
      },
    });

    const paymentStatus = await recalcOrderPaymentStatus(orderId, tx);
    if (
      (paymentStatus === CachedPaymentStatus.PAID ||
        paymentStatus === CachedPaymentStatus.OVERPAID) &&
      fresh.status === OrderStatus.PLACED
    ) {
      assertOrderTransition(OrderStatus.PLACED, OrderStatus.PAID);
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.PAID, version: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          action: AuditAction.ORDER_PAID,
          meta: { orderId, via: "stripe" },
        },
      });
    }
  });

  return ok({ orderId, replay: false });
}

/**
 * Apply a refund once per Stripe refund id (B3: charge.refunded + refund.created
 * must not double-increment refundedCents).
 */
async function handleChargeRefunded(refund: RefundObject): Promise<Result<{ synced: boolean }>> {
  if (!refund.payment_intent || !refund.id) return ok({ synced: false });

  // Per-refund idempotency key (distinct from Stripe event id).
  const appliedKey = `refund_applied:${refund.id}`;
  const claimed = await claimWebhookEvent(appliedKey, "refund.applied");
  if (!claimed) return ok({ synced: false });

  try {
    const payment = await db.payment.findFirst({
      where: {
        stripeChargeId: refund.payment_intent,
        method: PaymentMethod.STRIPE,
        state: PaymentState.POSTED,
      },
    });
    if (!payment) {
      await markWebhookEventProcessed(appliedKey, "refund.applied");
      return ok({ synced: false });
    }

    await db.payment.update({
      where: { id: payment.id },
      data: { refundedCents: { increment: refund.amount } },
    });
    await db.auditLog.create({
      data: {
        action: AuditAction.PAYMENT_REFUNDED,
        meta: {
          orderId: payment.orderId,
          paymentId: payment.id,
          refundId: refund.id,
          amountCents: refund.amount,
        },
      },
    });
    await recalcOrderPaymentStatus(payment.orderId);
    await markWebhookEventProcessed(appliedKey, "refund.applied");
    return ok({ synced: true });
  } catch (error) {
    // Leave appliedKey in processing so a retry can re-run.
    throw error;
  }
}

export async function processStripeWebhook(input: {
  rawBody: string;
  signature: string | null;
}): Promise<Result<{ type: string; replay: boolean }>> {
  if (!verifyWebhookSignature(input.rawBody, input.signature)) {
    return err("sig", "Invalid Stripe webhook signature.");
  }

  let event: {
    id: string;
    type: string;
    data: { object: Record<string, unknown> };
  };
  try {
    event = JSON.parse(input.rawBody);
  } catch {
    return err("json", "Invalid webhook JSON.");
  }

  let claimed: boolean;
  try {
    claimed = await claimWebhookEvent(event.id, event.type);
  } catch (error) {
    // Transient DB failure before claim → 500 so Stripe retries.
    return err(maskError(error), "Webhook claim failed.");
  }
  if (!claimed) {
    return ok({ type: event.type, replay: true });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as unknown as CheckoutCompletedObject;
      const result = await handleCheckoutSessionCompleted(session);
      if (!result.ok) return err(result.error, result.publicMessage);
      await markWebhookEventProcessed(event.id, event.type);
      return ok({ type: event.type, replay: result.value.replay });
    }
    if (event.type === "charge.refunded" || event.type === "refund.created") {
      const refund = event.data.object as unknown as RefundObject;
      await handleChargeRefunded(refund);
      await markWebhookEventProcessed(event.id, event.type);
      return ok({ type: event.type, replay: false });
    }
    await markWebhookEventProcessed(event.id, event.type);
    return ok({ type: event.type, replay: false });
  } catch (error) {
    // Leave event in processing; Stripe retry reclaims and re-runs.
    return err(maskError(error), "Webhook processing failed.");
  }
}

/** Build a signed mock checkout.session.completed event for smoke / mock pay. */
export function buildMockCheckoutCompletedEvent(input: {
  sessionId: string;
  orderId: string;
  amountCents: number;
  paymentIntentId?: string;
  eventId?: string;
}): { body: string; eventId: string } {
  const eventId = input.eventId ?? mintMockEventId();
  const body = JSON.stringify({
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: input.sessionId,
        amount_total: input.amountCents,
        payment_intent: input.paymentIntentId ?? mintMockPaymentIntentId(),
        payment_status: "paid",
        metadata: { orderId: input.orderId },
      },
    },
  });
  return { body, eventId };
}
