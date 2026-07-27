import 'server-only';

import { Prisma, type Payment } from '@prisma/client';
import { z } from 'zod';

import { recordAudit } from '../audit';
import { failure, ok, type Result } from '../core/result';
import { db } from '../db';
import { queueRefundNotice } from '../email/transactional';
import { transitionOrder } from '../orders/order-service';
import { recomputeOrderPaymentStatus } from '../orders/payment-status';
import { isPayableOrderStatus } from '../orders/state-machine';
import { getPaymentGateway } from './gateway';

/**
 * What the gateway tells us happened, applied exactly once (R-167).
 *
 * The order of operations matters. Every event is claimed in its own row before
 * anything is acted on, so a second delivery of an event that was already
 * applied loses the insert and changes nothing. An event that failed part way
 * hands the claim back, because Stripe retries a failed delivery for days and a
 * lock left behind would turn every one of those retries into a no-op while the
 * money sat at the provider. Money that arrived is always recorded as a payment
 * first, even when it is wrong; the amount safety check then cancels the order
 * and hands it back, which leaves an honest ledger instead of a charge nobody
 * wrote down.
 */
export const INVALID_WEBHOOK_BODY = 'invalid_webhook_body';

export type WebhookOutcome =
  | 'payment_posted'
  | 'auto_refunded'
  | 'refund_synced'
  | 'replay'
  | 'unpaid_session'
  | 'unknown_session'
  | 'ignored';

const eventSchema = z.object({
  id: z.string().min(1).max(255),
  type: z.string().min(1).max(120),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

export type StripeEvent = z.infer<typeof eventSchema>;

const completedSessionSchema = z.object({
  id: z.string().min(1),
  payment_intent: z.string().min(1),
  amount_total: z.number().int().nonnegative(),
  payment_status: z.string(),
});

const refundedChargeSchema = z.object({
  payment_intent: z.string().min(1),
  amount_refunded: z.number().int().nonnegative(),
  refunds: z.object({ data: z.array(z.object({ id: z.string().min(1) })) }).optional(),
});

export function parseStripeEvent(raw: unknown): Result<StripeEvent> {
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) return failure(INVALID_WEBHOOK_BODY, 'That is not an event we can read.');
  return ok(parsed.data);
}

export async function applyStripeEvent(event: StripeEvent): Promise<WebhookOutcome> {
  if (!(await claimEvent(event))) return 'replay';

  const outcome = await routeOrReleaseClaim(event);

  await db.stripeWebhookEvent.update({
    where: { eventId: event.id },
    data: { processedAt: new Date(), outcome },
  });

  return outcome;
}

/**
 * The claim row only means "this event is being dealt with" for as long as it is
 * being dealt with. Handing it back on the way out of a failure is what makes
 * the provider's retry run the work again instead of being answered `replay`.
 * Every step the retry re-runs checks for its own leftovers first.
 */
async function routeOrReleaseClaim(event: StripeEvent): Promise<WebhookOutcome> {
  try {
    return await route(event);
  } catch (error) {
    await db.stripeWebhookEvent.delete({ where: { eventId: event.id } });
    throw error;
  }
}

/**
 * The unique index on `eventId` is the idempotency lock. Two deliveries of the
 * same event racing each other both try to insert; one wins and does the work.
 */
async function claimEvent(event: StripeEvent): Promise<boolean> {
  try {
    await db.stripeWebhookEvent.create({ data: { eventId: event.id, type: event.type } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
    throw error;
  }
}

function route(event: StripeEvent): Promise<WebhookOutcome> {
  if (event.type === 'checkout.session.completed') return completeCheckout(event);
  if (event.type === 'charge.refunded') return syncRefund(event);
  return Promise.resolve('ignored');
}

async function completeCheckout(event: StripeEvent): Promise<WebhookOutcome> {
  const session = completedSessionSchema.safeParse(event.data.object);
  if (!session.success) return 'ignored';

  // A session can complete without money: a bank-debit method that is still
  // clearing, or a card that failed after the page was submitted.
  if (session.data.payment_status !== 'paid') return 'unpaid_session';

  const attempt = await db.stripePaymentIntent.findUnique({
    where: { stripeSessionId: session.data.id },
  });
  if (!attempt) return 'unknown_session';

  const chargedCents = session.data.amount_total;

  const payment = await recordStripePayment({
    attemptId: attempt.id,
    orderId: attempt.orderId,
    paymentIntentId: session.data.payment_intent,
    chargedCents,
  });

  const order = await db.order.findUniqueOrThrow({ where: { id: attempt.orderId } });

  // The order being past PLACED is not a reason to hand money back: a webhook
  // the provider retried, or one that arrived after staff started packing,
  // lands on an order that is still perfectly entitled to the payment. Only a
  // closed order or the wrong amount is unsafe.
  const orderIsOpen = isPayableOrderStatus(order.status);
  const unsafe = !orderIsOpen || chargedCents !== order.totalCents;
  if (!unsafe) return 'payment_posted';

  await handBackUnsafeCharge({
    eventId: event.id,
    orderId: order.id,
    paymentId: payment.id,
    paymentIntentId: session.data.payment_intent,
    chargedCents,
    expectedCents: order.totalCents,
    orderIsOpen,
  });

  return 'auto_refunded';
}

/**
 * The intent id is what the money is keyed by, so a retry of an event that
 * failed after this step finds its own row and returns it rather than writing
 * the charge down twice.
 */
async function recordStripePayment(charge: {
  attemptId: string;
  orderId: string;
  paymentIntentId: string;
  chargedCents: number;
}): Promise<Payment> {
  const already = await db.payment.findFirst({
    where: { orderId: charge.orderId, method: 'STRIPE', reference: charge.paymentIntentId },
  });
  if (already) return already;

  return db.$transaction(async (tx) => {
    await tx.stripePaymentIntent.update({
      where: { id: charge.attemptId },
      data: {
        stripeIntentId: charge.paymentIntentId,
        status: 'paid',
        amountCents: charge.chargedCents,
        lastEventAt: new Date(),
      },
    });

    const payment = await tx.payment.create({
      data: {
        orderId: charge.orderId,
        method: 'STRIPE',
        amountCents: charge.chargedCents,
        reference: charge.paymentIntentId,
      },
    });

    await recomputeOrderPaymentStatus(charge.orderId, tx);
    await recordAudit(
      null,
      {
        action: 'payment.posted',
        entityType: 'Payment',
        entityId: payment.id,
        detail: { method: 'STRIPE', amountCents: charge.chargedCents },
      },
      tx,
    );

    return payment;
  });
}

/**
 * R-126 and R-169: an amount that does not match the order is refunded in full
 * and the order is cancelled, which hands the stock back. Keeping the money
 * while somebody investigates is how a charity ends up owing refunds it has
 * already spent.
 *
 * The cancel runs first. Refunding first and then losing the transition — to a
 * race, or to the state machine refusing the move — would leave the customer
 * paid back against an order still holding stock, with an audit row saying the
 * opposite. Failing before any money moves is recoverable: the event throws, the
 * provider retries, and the retry picks up where this left off.
 */
async function handBackUnsafeCharge(unsafe: {
  eventId: string;
  orderId: string;
  paymentId: string;
  paymentIntentId: string;
  chargedCents: number;
  expectedCents: number;
  orderIsOpen: boolean;
}): Promise<void> {
  const reason =
    unsafe.orderIsOpen
      ? `Charged ${unsafe.chargedCents} cents for an order that costs ${unsafe.expectedCents}`
      : 'Charged for an order that is no longer open';

  if (unsafe.orderIsOpen) {
    const cancelled = await transitionOrder(unsafe.orderId, 'CANCELLED', null);
    if (!cancelled.ok) {
      throw new Error(
        `Order ${unsafe.orderId} took ${unsafe.chargedCents} cents it should not have and could not be cancelled (${cancelled.code}). Nothing has been refunded yet.`,
      );
    }
  }

  if (await isFullyRefunded(unsafe.paymentId, unsafe.chargedCents)) return;

  const receipt = await getPaymentGateway().refund({
    paymentIntentId: unsafe.paymentIntentId,
    amountCents: unsafe.chargedCents,
    reason,
    idempotencyKey: `auto-refund-${unsafe.eventId}`,
  });

  await db.$transaction(async (tx) => {
    const refund = await tx.paymentRefund.create({
      data: {
        paymentId: unsafe.paymentId,
        amountCents: receipt.amountCents,
        reference: receipt.refundId,
        reason,
      },
    });

    await recomputeOrderPaymentStatus(unsafe.orderId, tx);
    await queueRefundNotice(
      unsafe.orderId,
      { refundId: refund.id, amountCents: receipt.amountCents, reason },
      tx,
    );
    await recordAudit(
      null,
      {
        action: 'payment.auto_refunded',
        entityType: 'Order',
        entityId: unsafe.orderId,
        detail: { chargedCents: unsafe.chargedCents, expectedCents: unsafe.expectedCents },
      },
      tx,
    );
  });
}

/** What a retry checks before handing the same charge back a second time. */
async function isFullyRefunded(paymentId: string, chargedCents: number): Promise<boolean> {
  const refunded = await db.paymentRefund.aggregate({
    where: { paymentId },
    _sum: { amountCents: true },
  });

  return (refunded._sum.amountCents ?? 0) >= chargedCents;
}

/**
 * R-168. A refund issued in the Stripe dashboard is money the org gave back,
 * and the order has to know. Only the difference is recorded, so a second
 * `charge.refunded` after a partial refund adds the second part and nothing else.
 */
async function syncRefund(event: StripeEvent): Promise<WebhookOutcome> {
  const charge = refundedChargeSchema.safeParse(event.data.object);
  if (!charge.success) return 'ignored';

  const payment = await db.payment.findFirst({
    where: { method: 'STRIPE', reference: charge.data.payment_intent },
    include: { refunds: true },
  });
  if (!payment) return 'unknown_session';

  const alreadyRefunded = payment.refunds.reduce((total, refund) => total + refund.amountCents, 0);
  const outstanding = charge.data.amount_refunded - alreadyRefunded;
  if (outstanding <= 0) return 'ignored';

  const reason = 'Refunded through the payment provider';

  await db.$transaction(async (tx) => {
    const refund = await tx.paymentRefund.create({
      data: {
        paymentId: payment.id,
        amountCents: outstanding,
        reference: charge.data.refunds?.data.at(-1)?.id ?? event.id,
        reason,
      },
    });

    await recomputeOrderPaymentStatus(payment.orderId, tx);
    await queueRefundNotice(
      payment.orderId,
      { refundId: refund.id, amountCents: outstanding, reason },
      tx,
    );
    await recordAudit(
      null,
      {
        action: 'payment.refunded',
        entityType: 'Payment',
        entityId: payment.id,
        detail: { amountCents: outstanding, reason },
      },
      tx,
    );
  });

  return 'refund_synced';
}
