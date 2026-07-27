import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import type { Order } from '@prisma/client';

import { startCheckout } from '../src/lib/checkout/checkout-service';
import { transitionOrder } from '../src/lib/orders/order-service';
import { recomputeOrderPaymentStatus } from '../src/lib/orders/payment-status';
import {
  OFFLINE_PAYMENT_NOT_ALLOWED,
  ORDER_NOT_PAYABLE,
  postOfflinePayment,
  refundPayment,
  voidPayment,
} from '../src/lib/payments/offline-payments';
import { reconcilePayments } from '../src/lib/payments/reconciliation';
import { signStripePayload, verifyStripeSignature } from '../src/lib/payments/stripe-signature';
import { applyStripeEvent, parseStripeEvent } from '../src/lib/payments/webhook-service';
import type { DraftOwner } from '../src/lib/orders/draft-access';
import { writeSetting } from '../src/lib/settings';
import {
  createCustomer,
  createDraftOrder,
  createFulfillmentMethod,
  createProduct,
  createSeason,
  createStaffContext,
  db,
} from './fixtures';

/**
 * Money arrives from two places — a webhook nobody in the office can see, and a
 * member of staff at a counter — and both of them can be wrong. These tests are
 * about what happens then: a replayed event, a charge for the wrong amount, a
 * payment keyed twice, a refund issued in the provider's dashboard.
 */

after(() => db.$disconnect());

const SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

let eventCounter = 0;

function nextEventId(): string {
  eventCounter += 1;
  return `evt_test_${Date.now().toString(36)}_${eventCounter}`;
}

/**
 * Event ids and charge ids both carry unique indexes — that is what makes a
 * replay a no-op — and this database is not emptied between runs, so a literal
 * id would only work the first time the file is run.
 */
function nextIntentId(label: string): string {
  eventCounter += 1;
  return `pi_test_${label}_${Date.now().toString(36)}_${eventCounter}`;
}

function completedSession(session: {
  id: string;
  intentId: string;
  amountCents: number;
  eventId?: string;
}) {
  return {
    id: session.eventId ?? nextEventId(),
    type: 'checkout.session.completed',
    data: {
      object: {
        id: session.id,
        payment_intent: session.intentId,
        amount_total: session.amountCents,
        payment_status: 'paid',
      },
    },
  };
}

async function apply(raw: unknown): Promise<string> {
  const event = parseStripeEvent(raw);
  assert.equal(event.ok, true);
  if (!event.ok) throw new Error('unreachable');
  return applyStripeEvent(event.value);
}

/** A placed order with an open hosted session, the way checkout leaves things. */
async function placedOrderAwaitingPayment(priceCents = 3600): Promise<{
  order: Order;
  sessionId: string;
}> {
  await writeSetting('delivery.dayChoices', []);

  const season = await createSeason();
  const customer = await createCustomer();
  const owner: DraftOwner = { kind: 'customer', customerId: customer.id };
  const product = await createProduct(season, { priceCents, onHand: 10 });
  const pickup = await createFulfillmentMethod('PICKUP', 0, 'NONE');

  await createDraftOrder({ season, customer, lines: [{ product, fulfillmentMethodId: pickup.id }] });

  const started = await startCheckout(owner, season.id, {
    expectedTotalCents: priceCents,
    contact: null,
  });
  assert.equal(started.ok, true);
  if (!started.ok) throw new Error('unreachable');

  const attempt = await db.stripePaymentIntent.findFirstOrThrow({
    where: { orderId: started.value.orderId },
  });

  return {
    order: await db.order.findUniqueOrThrow({ where: { id: started.value.orderId } }),
    sessionId: attempt.stripeSessionId,
  };
}

test('a signature is only good for its own body, its own secret and its own hour', () => {
  const payload = JSON.stringify({ id: 'evt_1' });
  const now = Math.floor(Date.now() / 1000);
  const header = signStripePayload(payload, SECRET, now);

  assert.equal(verifyStripeSignature(payload, header, SECRET, now).ok, true);
  assert.equal(verifyStripeSignature(`${payload} `, header, SECRET, now).ok, false, 'body edited');
  assert.equal(verifyStripeSignature(payload, header, 'another-secret', now).ok, false);
  assert.equal(verifyStripeSignature(payload, header, SECRET, now + 3600).ok, false, 'too old');
  assert.equal(verifyStripeSignature(payload, null, SECRET, now).ok, false, 'no header at all');
});

test('a paid session posts one payment, and a replay of it posts none', async () => {
  const { order, sessionId } = await placedOrderAwaitingPayment();
  const intentId = nextIntentId('paid');
  const event = completedSession({ id: sessionId, intentId, amountCents: order.totalCents });

  assert.equal(await apply(event), 'payment_posted');
  assert.equal(await apply(event), 'replay', 'the provider retries for days');

  const payments = await db.payment.findMany({ where: { orderId: order.id } });
  assert.equal(payments.length, 1);
  assert.equal(payments[0].method, 'STRIPE');

  const paid = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(paid.paymentStatus, 'PAID');
  assert.equal(paid.amountPaidCents, order.totalCents);
  assert.equal(paid.status, 'PLACED');

  const attempt = await db.stripePaymentIntent.findUniqueOrThrow({ where: { stripeSessionId: sessionId } });
  assert.equal(attempt.status, 'paid');
  assert.equal(attempt.stripeIntentId, intentId);
});

test('a charge for the wrong amount is recorded, handed straight back, and the order cancelled', async () => {
  const { order, sessionId } = await placedOrderAwaitingPayment(5000);

  const outcome = await apply(
    completedSession({ id: sessionId, intentId: nextIntentId('wrong'), amountCents: 1 }),
  );
  assert.equal(outcome, 'auto_refunded');

  const payment = await db.payment.findFirstOrThrow({
    where: { orderId: order.id },
    include: { refunds: true },
  });
  assert.equal(payment.amountCents, 1, 'what arrived is written down, wrong or not');
  assert.equal(payment.refunds.length, 1);
  assert.equal(payment.refunds[0].amountCents, 1);

  const cancelled = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.amountPaidCents, 0, 'paid, then given back, nets to nothing');

  const released = await db.reservation.findMany({ where: { orderId: order.id } });
  assert.ok(
    released.every((reservation) => reservation.status === 'RELEASED'),
    'cancelling puts the stock back on the shelf',
  );

  const audited = await db.auditEvent.findFirst({
    where: { action: 'payment.auto_refunded', entityId: order.id },
  });
  assert.ok(audited, 'the refund is in the audit trail');
});

test('a correct charge is kept when the order has already gone to packing', async () => {
  const { order, sessionId } = await placedOrderAwaitingPayment(4200);

  const packing = await transitionOrder(order.id, 'IN_FULFILLMENT', null);
  assert.equal(packing.ok, true);

  const outcome = await apply(
    completedSession({ id: sessionId, intentId: nextIntentId('late'), amountCents: 4200 }),
  );
  assert.equal(outcome, 'payment_posted', 'a retried webhook is not a reason to refund');

  const paid = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(paid.status, 'IN_FULFILLMENT', 'the order stays in the packing queue');
  assert.equal(paid.paymentStatus, 'PAID');
  assert.equal(
    await db.paymentRefund.count({ where: { payment: { orderId: order.id } } }),
    0,
    'the customer keeps neither a refund nor an unpaid box',
  );
});

test('a wrong amount is still handed back once packing has started', async () => {
  const { order, sessionId } = await placedOrderAwaitingPayment(4200);

  const packing = await transitionOrder(order.id, 'IN_FULFILLMENT', null);
  assert.equal(packing.ok, true);

  const outcome = await apply(
    completedSession({ id: sessionId, intentId: nextIntentId('lateshort'), amountCents: 100 }),
  );
  assert.equal(outcome, 'auto_refunded');

  const cancelled = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(cancelled.status, 'CANCELLED', 'the stage widened, the amount check did not');
  assert.equal(cancelled.amountPaidCents, 0);
});

test('a session that completes without money posts nothing', async () => {
  const { order, sessionId } = await placedOrderAwaitingPayment();

  const outcome = await apply({
    id: nextEventId(),
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        payment_intent: nextIntentId('pending'),
        amount_total: order.totalCents,
        payment_status: 'unpaid',
      },
    },
  });

  assert.equal(outcome, 'unpaid_session');
  assert.equal(await db.payment.count({ where: { orderId: order.id } }), 0);
});

test('a refund issued at the provider is synced once, then only the difference', async () => {
  const { order, sessionId } = await placedOrderAwaitingPayment(4000);
  const intentId = nextIntentId('refund');
  await apply(completedSession({ id: sessionId, intentId, amountCents: 4000 }));

  const partial = await apply({
    id: nextEventId(),
    type: 'charge.refunded',
    data: {
      object: {
        payment_intent: intentId,
        amount_refunded: 1500,
        refunds: { data: [{ id: `re_${intentId}_1` }] },
      },
    },
  });
  assert.equal(partial, 'refund_synced');

  const afterPartial = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(afterPartial.amountPaidCents, 2500);
  assert.equal(afterPartial.paymentStatus, 'PARTIALLY_PAID');

  const rest = await apply({
    id: nextEventId(),
    type: 'charge.refunded',
    data: {
      object: {
        payment_intent: intentId,
        amount_refunded: 4000,
        refunds: { data: [{ id: `re_${intentId}_2` }] },
      },
    },
  });
  assert.equal(rest, 'refund_synced');

  const refunds = await db.paymentRefund.findMany({ where: { payment: { orderId: order.id } } });
  assert.deepEqual(
    refunds.map((refund) => refund.amountCents).sort((left, right) => left - right),
    [1500, 2500],
    'the second event adds what the first one did not cover',
  );

  const emptied = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(emptied.amountPaidCents, 0);
  assert.equal(emptied.paymentStatus, 'UNPAID');
});

test('an order edited after it was paid shows up as an amount mismatch', async () => {
  const { order, sessionId } = await placedOrderAwaitingPayment(3600);
  await apply(completedSession({ id: sessionId, intentId: nextIntentId('edited'), amountCents: 3600 }));

  await db.order.update({ where: { id: order.id }, data: { totalCents: 4200 } });
  await reconcilePayments({ source: 'manual' });

  const flag = await db.paymentReconciliationFlag.findUnique({
    where: { fingerprint: `amount_mismatch:${sessionId}` },
  });

  assert.ok(flag, 'the sweep is what catches a payment the order has grown past');
  assert.equal(flag.kind, 'AMOUNT_MISMATCH');
  assert.equal(flag.amountCents, 3600, 'what was taken');
  assert.equal(flag.expectedCents, 4200, 'what the order now costs');
});

test('an event for a session we never opened changes nothing', async () => {
  const outcome = await apply(
    completedSession({ id: 'cs_never_seen', intentId: nextIntentId('orphan'), amountCents: 100 }),
  );
  assert.equal(outcome, 'unknown_session');
});

test('an event that fails part way is retried, not answered as a replay', async () => {
  const { order, sessionId } = await placedOrderAwaitingPayment(4000);
  const intentId = nextIntentId('retry');
  await apply(completedSession({ id: sessionId, intentId, amountCents: 4000 }));

  const payment = await db.payment.findFirstOrThrow({ where: { orderId: order.id } });
  const refundId = `re_${intentId}_clash`;

  // The refund reference carries a unique index, so a row already holding this
  // provider refund id is a failure the handler cannot write through.
  const blocker = await db.paymentRefund.create({
    data: { paymentId: payment.id, amountCents: 500, reference: refundId, reason: 'Counter refund' },
  });

  const event = {
    id: nextEventId(),
    type: 'charge.refunded',
    data: {
      object: {
        payment_intent: intentId,
        amount_refunded: 1000,
        refunds: { data: [{ id: refundId }] },
      },
    },
  };

  await assert.rejects(() => apply(event), 'the endpoint answers 500 and the provider retries');
  assert.equal(
    await db.stripeWebhookEvent.findUnique({ where: { eventId: event.id } }),
    null,
    'the claim is handed back, or every retry would be dropped as a replay',
  );

  await db.paymentRefund.delete({ where: { id: blocker.id } });

  assert.equal(await apply(event), 'refund_synced', 'the retry does the work the first delivery could not');

  const refunds = await db.paymentRefund.findMany({ where: { paymentId: payment.id } });
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].amountCents, 1000);
});

test('cash and checks are staff-only, and a void takes the money back off the order', async () => {
  const { order } = await placedOrderAwaitingPayment(3600);

  const staff = await createStaffContext();
  const withoutPermission = { ...staff, permissions: staff.permissions.filter((p) => p !== 'orders.manage') };

  const refused = await postOfflinePayment(withoutPermission, {
    orderId: order.id,
    method: 'CASH',
    amountCents: 3600,
  });
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.code, OFFLINE_PAYMENT_NOT_ALLOWED);

  const allowed = { ...staff, permissions: [...staff.permissions, 'orders.manage' as const] };
  const posted = await postOfflinePayment(allowed, {
    orderId: order.id,
    method: 'CHECK',
    amountCents: 3600,
    reference: '1042',
  });
  assert.equal(posted.ok, true);
  if (!posted.ok) return;

  const paid = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(paid.paymentStatus, 'PAID');

  const voided = await voidPayment(allowed, { paymentId: posted.value.id, reason: 'Keyed twice' });
  assert.equal(voided.ok, true);

  const afterVoid = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(afterVoid.amountPaidCents, 0);
  assert.equal(afterVoid.paymentStatus, 'UNPAID');

  const stillThere = await db.payment.findUniqueOrThrow({ where: { id: posted.value.id } });
  assert.equal(stillThere.state, 'VOIDED', 'a mistake is voided, never deleted');
  assert.equal(stillThere.voidReason, 'Keyed twice');

  const audited = await db.auditEvent.findMany({
    where: { entityId: posted.value.id, action: { in: ['payment.posted', 'payment.voided'] } },
  });
  assert.equal(audited.length, 2, 'both the taking and the voiding name the staff member');
  assert.ok(audited.every((row) => row.actorStaffUserId === staff.actor.id));
});

test('a refund cannot exceed what is left of the payment', async () => {
  const { order } = await placedOrderAwaitingPayment(3600);
  const staff = await createStaffContext();
  const allowed = { ...staff, permissions: [...staff.permissions, 'orders.manage' as const] };

  const posted = await postOfflinePayment(allowed, {
    orderId: order.id,
    method: 'CASH',
    amountCents: 3600,
  });
  assert.equal(posted.ok, true);
  if (!posted.ok) return;

  const half = await refundPayment(allowed, {
    paymentId: posted.value.id,
    amountCents: 2000,
    reason: 'One box short',
  });
  assert.equal(half.ok, true);

  const tooMuch = await refundPayment(allowed, {
    paymentId: posted.value.id,
    amountCents: 2000,
    reason: 'Again',
  });
  assert.equal(tooMuch.ok, false);

  const recounted = await recomputeOrderPaymentStatus(order.id);
  assert.equal(recounted, 'PARTIALLY_PAID');

  const afterRefund = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(afterRefund.amountPaidCents, 1600);
});

test('the counter cannot overpay an order, or take money for a closed one', async () => {
  const { order } = await placedOrderAwaitingPayment(3600);
  const staff = await createStaffContext();
  const allowed = { ...staff, permissions: [...staff.permissions, 'orders.manage' as const] };

  const overpaid = await postOfflinePayment(allowed, {
    orderId: order.id,
    method: 'CASH',
    amountCents: 5000,
  });
  assert.equal(overpaid.ok, false, 'a $50 note against a $36 order is a mistake, not a donation');

  const cancelled = await transitionOrder(order.id, 'CANCELLED', null);
  assert.equal(cancelled.ok, true);

  const afterCancel = await postOfflinePayment(allowed, {
    orderId: order.id,
    method: 'CASH',
    amountCents: 1000,
  });
  assert.equal(afterCancel.ok, false);
  if (afterCancel.ok) return;
  assert.equal(afterCancel.code, ORDER_NOT_PAYABLE);

  assert.equal(
    await db.payment.count({ where: { orderId: order.id } }),
    0,
    'neither attempt left money on an order with no stock behind it',
  );
});

test('a draft cannot be paid for at the counter', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const product = await createProduct(season);
  const pickup = await createFulfillmentMethod('PICKUP', 0, 'NONE');

  const draft = await createDraftOrder({
    season,
    customer,
    lines: [{ product, fulfillmentMethodId: pickup.id }],
  });

  const staff = await createStaffContext();
  const allowed = { ...staff, permissions: [...staff.permissions, 'orders.manage' as const] };

  const refused = await postOfflinePayment(allowed, {
    orderId: draft.id,
    method: 'CASH',
    amountCents: 1000,
  });

  assert.equal(refused.ok, false);
});
