import { z } from "zod";
import { Order, OrderLine } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { postPaymentTx, voidPaymentTx } from "@/lib/payments/post";
import { createRefund, getStripeConfig } from "@/lib/payments/stripe";
import { releaseOrderReservation } from "@/lib/checkout/reservations";
import { commitSubmittedOrder } from "@/lib/checkout/finalize";
import { findOrderForSession } from "@/lib/checkout/order-load";

// Webhook payload shapes. The signature check guarantees authenticity, but
// the payload is still external input — the route parses with these schemas
// instead of asserting casts, so a malformed (but signed) event is a clean
// 400 rather than `undefined` leaking into domain logic.
export const checkoutSessionObjectSchema = z.object({
  id: z.string().min(1),
  amount_total: z.number().int().nullish(),
  payment_intent: z.string().nullish(),
  client_reference_id: z.string().nullish(),
  metadata: z.object({ orderId: z.string().min(1).optional() }).nullish(),
});
export type StripeSessionCompleted = z.infer<typeof checkoutSessionObjectSchema>;

export const chargeRefundedObjectSchema = z.object({
  id: z.string().min(1),
  payment_intent: z.string().nullable(),
});
export type StripeChargeRefunded = z.infer<typeof chargeRefundedObjectSchema>;

// R-126/R-169: the charged amount failed a safety check (or the order left
// checkout before the payment landed). Never finalize; refund first, then
// release the reservation and write the audit row in one transaction. A
// thrown refund call propagates to the webhook route (500 + Stripe retry)
// with the reservation still held, so a persistent refund failure can never
// strand a captured charge on a re-payable order.
async function safetyRefund(
  order: Order & { lines: OrderLine[] },
  session: StripeSessionCompleted,
  reason: string,
): Promise<void> {
  let refundId: string | null = null;
  if (session.payment_intent && getStripeConfig().secretKey) {
    const refund = await createRefund(session.payment_intent);
    refundId = refund.id;
  }
  await prisma.$transaction(async (tx) => {
    await releaseOrderReservation(tx, order.id);
    await recordAudit(
      {
        actor: null,
        action: "payment_auto_refund",
        targetType: "Order",
        targetId: order.id,
        metadata: {
          reason,
          sessionId: session.id,
          paymentIntent: session.payment_intent ?? null,
          chargedCents: session.amount_total ?? null,
          expectedCents: order.totalCents,
          stripeRefundId: refundId,
        },
      },
      tx,
    );
  });
}

// R-167 webhook success path: commit stock, finalize, post the payment,
// remember greetings — one transaction, so a replay (idempotency key on the
// event row, handled by the route) can never double any of them.
export async function completeCheckoutSession(
  session: StripeSessionCompleted,
): Promise<{ outcome: "finalized" | "duplicate" | "safety_refund" | "ignored"; orderId?: string; orderNumber?: number }> {
  const order = await findOrderForSession(session);
  if (!order) return { outcome: "ignored" };

  if (order.status === "FINALIZED") {
    const alreadyPosted = order.payments.some(
      (payment) => payment.externalRef !== null && payment.externalRef === session.payment_intent,
    );
    const sameSession = order.stripeSessionId !== null && order.stripeSessionId === session.id;
    if (alreadyPosted || sameSession) {
      return { outcome: "duplicate", orderId: order.id, orderNumber: order.orderNumber ?? undefined };
    }
    // New money landing on an already-final order (a POS finalize raced a
    // live session, or a second session was paid): the charge must not stand.
    await safetyRefund(order, session, "order already finalized before this session completed");
    return { outcome: "safety_refund", orderId: order.id };
  }
  if (order.status !== "DRAFT") {
    // Paid for a discarded draft — the charge must not stand.
    await safetyRefund(order, session, `order is ${order.status}`);
    return { outcome: "safety_refund", orderId: order.id };
  }
  if (order.stripeSessionId && order.stripeSessionId !== session.id) {
    await safetyRefund(order, session, "session id mismatch");
    return { outcome: "safety_refund", orderId: order.id };
  }
  if (session.amount_total !== order.totalCents) {
    await safetyRefund(order, session, "charged amount differs from the order total");
    return { outcome: "safety_refund", orderId: order.id };
  }
  if (!order.stockReserved) {
    // Payment landed with no checkout submit on record — same safety rule.
    await safetyRefund(order, session, "order has no stock reservation (checkout never submitted)");
    return { outcome: "safety_refund", orderId: order.id };
  }
  if (order.season.status !== "OPEN") {
    // The season closed between submit and this payment landing — finalizing
    // would throw inside the state machine, so refund instead of retrying
    // forever against a captured charge.
    await safetyRefund(order, session, `season ${order.season.name} closed before the payment landed`);
    return { outcome: "safety_refund", orderId: order.id };
  }

  const finalized = await prisma.$transaction(async (tx) => {
    const committed = await commitSubmittedOrder(tx, order);
    await postPaymentTx(tx, {
      orderId: order.id,
      method: "STRIPE",
      // The order total is the server truth; the session amount already
      // matched it above.
      amountCents: order.totalCents,
      externalRef: session.payment_intent,
    });
    if (session.payment_intent) {
      await tx.stripePaymentIntent.upsert({
        where: { intentId: session.payment_intent },
        update: { status: "succeeded" },
        create: {
          orderId: order.id,
          intentId: session.payment_intent,
          amountCents: session.amount_total ?? order.totalCents,
          status: "succeeded",
          // Session id only — card/PII fields never persist.
          raw: { sessionId: session.id },
        },
      });
    }
    return committed;
  });
  return { outcome: "finalized", orderId: order.id, orderNumber: finalized.orderNumber ?? undefined };
}

// checkout.session.expired (or the hosted page was abandoned): hand the
// reserved stock back.
export async function expireCheckoutSession(session: StripeSessionCompleted): Promise<boolean> {
  const order = await findOrderForSession(session);
  if (!order || order.status !== "DRAFT") return false;
  await prisma.$transaction((tx) => releaseOrderReservation(tx, order.id));
  return true;
}

// R-168 refund sync: a Stripe-side refund voids the posted payment and the
// cached status recomputes; the audit row commits in the same transaction so
// a void can never exist without its durable record.
export async function syncChargeRefunded(charge: StripeChargeRefunded): Promise<{ voided: boolean }> {
  if (!charge.payment_intent) return { voided: false };
  const payment = await prisma.payment.findFirst({
    where: { externalRef: charge.payment_intent, status: "POSTED" },
  });
  if (!payment) return { voided: false };
  await prisma.$transaction(async (tx) => {
    await voidPaymentTx(tx, payment.id, `stripe refund on charge ${charge.id}`);
    await recordAudit(
      {
        actor: null,
        action: "payment_void",
        targetType: "Payment",
        targetId: payment.id,
        metadata: { reason: `stripe refund on charge ${charge.id}`, source: "stripe_webhook" },
      },
      tx,
    );
  });
  return { voided: true };
}
