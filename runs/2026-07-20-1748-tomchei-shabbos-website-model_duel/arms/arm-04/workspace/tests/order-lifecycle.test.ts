import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { advancePackageStage } from '../src/lib/fulfillment/packages';
import {
  discardDraft,
  EMPTY_ORDER,
  finalizeOrder,
  SEASON_CLOSED,
  transitionOrder,
} from '../src/lib/orders/order-service';
import { recomputeOrderPaymentStatus } from '../src/lib/orders/payment-status';
import { ILLEGAL_TRANSITION } from '../src/lib/orders/state-machine';
import {
  createCustomer,
  createDraftOrder,
  createFulfillmentMethod,
  createProduct,
  createSeason,
  db,
} from './fixtures';

after(() => db.$disconnect());

test('finalizing explodes the lines into packages and links each line to its box', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const deliver = await createFulfillmentMethod('DELIVERY', 500);
  const product = await createProduct(season, { priceCents: 3600 });

  const draft = await createDraftOrder({
    season,
    customer,
    lines: [
      { product, fulfillmentMethodId: deliver.id, recipientName: 'Miriam Klein', greetingMessage: 'Happy Purim' },
      { product, fulfillmentMethodId: deliver.id, recipientName: 'Miriam Klein', greetingMessage: 'Happy Purim' },
      { product, fulfillmentMethodId: deliver.id, recipientName: 'Rabbi Stein', greetingMessage: 'Happy Purim' },
    ],
  });

  const finalized = await finalizeOrder(draft.id, null);
  assert.equal(finalized.ok, true);
  assert.equal(finalized.ok && finalized.value.packageCount, 2);

  const packages = await db.package.findMany({ where: { orderId: draft.id }, include: { lines: true } });
  assert.deepEqual(
    packages.map((row) => row.lines.length).sort(),
    [1, 2],
    'the two boxes for one recipient merge and the third stands alone',
  );
  assert.ok(packages.every((row) => row.stage === 'NEW'));

  // Fulfillment is charged per package, so two packages pay the fee twice.
  const placed = await db.order.findUniqueOrThrow({ where: { id: draft.id } });
  assert.equal(placed.subtotalCents, 3 * 3600);
  assert.equal(placed.fulfillmentFeeCents, 2 * 500);
  assert.equal(placed.totalCents, 3 * 3600 + 2 * 500);
});

test('a price change after the order is placed does not move what the customer owes', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const method = await createFulfillmentMethod();
  const product = await createProduct(season, { priceCents: 3600 });

  const draft = await createDraftOrder({
    season,
    customer,
    lines: [{ product, fulfillmentMethodId: method.id, quantity: 2 }],
  });
  await finalizeOrder(draft.id, null);

  await db.product.update({ where: { id: product.id }, data: { priceCents: 9900, name: 'Renamed' } });

  const line = await db.orderLine.findFirstOrThrow({ where: { orderId: draft.id } });
  assert.equal(line.unitPriceCents, 3600);
  assert.equal(line.lineTotalCents, 7200);
  assert.notEqual(line.productNameSnapshot, 'Renamed');
});

test('a closed season takes no new orders', async () => {
  const season = await createSeason('CLOSED');
  const customer = await createCustomer();
  const method = await createFulfillmentMethod();
  const product = await createProduct(season);

  const draft = await createDraftOrder({
    season,
    customer,
    lines: [{ product, fulfillmentMethodId: method.id }],
  });

  const refused = await finalizeOrder(draft.id, null);
  assert.equal(refused.ok === false && refused.code, SEASON_CLOSED);

  const untouched = await db.order.findUniqueOrThrow({ where: { id: draft.id } });
  assert.equal(untouched.status, 'DRAFT');
});

test('an empty cart cannot be placed', async () => {
  const season = await createSeason();
  const customer = await createCustomer();

  const draft = await createDraftOrder({ season, customer, lines: [] });

  const refused = await finalizeOrder(draft.id, null);
  assert.equal(refused.ok === false && refused.code, EMPTY_ORDER);
});

test('discarding a draft leaves no order number behind', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const method = await createFulfillmentMethod();
  const product = await createProduct(season);

  const draft = await createDraftOrder({
    season,
    customer,
    lines: [{ product, fulfillmentMethodId: method.id }],
  });

  const discarded = await discardDraft(draft.id, null);
  assert.equal(discarded.ok, true);
  assert.equal(discarded.ok && discarded.value.orderNumber, null);
  assert.ok(discarded.ok && discarded.value.discardedAt !== null);

  const seasonAfter = await db.season.findUniqueOrThrow({ where: { id: season.id } });
  assert.equal(seasonAfter.nextOrderNumber, 1);

  const secondAttempt = await finalizeOrder(draft.id, null);
  assert.equal(secondAttempt.ok === false && secondAttempt.code, ILLEGAL_TRANSITION);
});

test('cancelling a placed order hands the stock back', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const method = await createFulfillmentMethod();
  const product = await createProduct(season, { onHand: 5 });

  const draft = await createDraftOrder({
    season,
    customer,
    lines: [{ product, fulfillmentMethodId: method.id, quantity: 3 }],
  });
  await finalizeOrder(draft.id, null);

  const reserved = await db.inventoryItem.findUniqueOrThrow({ where: { productId: product.id } });
  assert.equal(reserved.reserved, 3);

  const cancelled = await transitionOrder(draft.id, 'CANCELLED', null);
  assert.equal(cancelled.ok, true);

  const released = await db.inventoryItem.findUniqueOrThrow({ where: { productId: product.id } });
  assert.equal(released.reserved, 0);

  const reservations = await db.reservation.findMany({ where: { orderId: draft.id } });
  assert.deepEqual(
    reservations.map((reservation) => [reservation.quantity, reservation.status]),
    [[3, 'RELEASED']],
    'the reservation is spent, not deleted, so a second cancel cannot release it again',
  );
});

test('a placed order walks forward to completed, versioned and audited at every step', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const method = await createFulfillmentMethod();
  const product = await createProduct(season, { onHand: 4 });

  const draft = await createDraftOrder({
    season,
    customer,
    lines: [{ product, fulfillmentMethodId: method.id, quantity: 2 }],
  });
  await finalizeOrder(draft.id, null);
  const placed = await db.order.findUniqueOrThrow({ where: { id: draft.id } });

  const packing = await transitionOrder(draft.id, 'IN_FULFILLMENT', null);
  assert.equal(packing.ok && packing.value.status, 'IN_FULFILLMENT');
  assert.equal(packing.ok && packing.value.version, placed.version + 1);

  const completed = await transitionOrder(draft.id, 'COMPLETED', null);
  assert.equal(completed.ok && completed.value.status, 'COMPLETED');
  assert.equal(completed.ok && completed.value.version, placed.version + 2);
  assert.equal(completed.ok && completed.value.discardedAt, null, 'finishing an order is not discarding it');

  const stock = await db.inventoryItem.findUniqueOrThrow({ where: { productId: product.id } });
  assert.equal(stock.reserved, 2, 'a completed order keeps the stock that went out the door');

  const moves = await db.auditEvent.findMany({
    where: { entityType: 'Order', entityId: draft.id, action: 'order.status_changed' },
    orderBy: { createdAt: 'asc' },
  });
  assert.deepEqual(moves.map((event) => event.detail), [
    { from: 'PLACED', to: 'IN_FULFILLMENT' },
    { from: 'IN_FULFILLMENT', to: 'COMPLETED' },
  ]);
});

test('the service refuses an illegal transition, not just the pure check', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const method = await createFulfillmentMethod();
  const product = await createProduct(season);

  const draft = await createDraftOrder({
    season,
    customer,
    lines: [{ product, fulfillmentMethodId: method.id }],
  });

  const skipped = await transitionOrder(draft.id, 'COMPLETED', null);
  assert.equal(skipped.ok === false && skipped.code, ILLEGAL_TRANSITION);

  const untouched = await db.order.findUniqueOrThrow({ where: { id: draft.id } });
  assert.equal(untouched.status, 'DRAFT');
});

test('the cached payment status follows posted and voided payments', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const method = await createFulfillmentMethod();
  const product = await createProduct(season, { priceCents: 5000 });

  const draft = await createDraftOrder({
    season,
    customer,
    lines: [{ product, fulfillmentMethodId: method.id }],
  });
  await finalizeOrder(draft.id, null);

  assert.equal(await recomputeOrderPaymentStatus(draft.id), 'UNPAID');

  const part = await db.payment.create({
    data: { orderId: draft.id, method: 'CHECK', amountCents: 2000, reference: '1042' },
  });
  assert.equal(await recomputeOrderPaymentStatus(draft.id), 'PARTIALLY_PAID');

  await db.payment.create({ data: { orderId: draft.id, method: 'CASH', amountCents: 3000 } });
  assert.equal(await recomputeOrderPaymentStatus(draft.id), 'PAID');

  await db.payment.update({
    where: { id: part.id },
    data: { state: 'VOIDED', voidedAt: new Date(), voidReason: 'Check bounced' },
  });
  assert.equal(await recomputeOrderPaymentStatus(draft.id), 'PARTIALLY_PAID');

  const cached = await db.order.findUniqueOrThrow({ where: { id: draft.id } });
  assert.equal(cached.amountPaidCents, 3000, 'the cache is recounted, never adjusted by a delta');
});

test('advancing a package stage is audited and refuses a stale version', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const method = await createFulfillmentMethod('SHIPPING');
  const product = await createProduct(season);

  const draft = await createDraftOrder({
    season,
    customer,
    lines: [{ product, fulfillmentMethodId: method.id }],
  });
  await finalizeOrder(draft.id, null);

  const box = await db.package.findFirstOrThrow({ where: { orderId: draft.id } });

  const printed = await advancePackageStage(
    { packageId: box.id, expectedVersion: box.version, stage: 'PRINTED' },
    null,
  );
  assert.equal(printed.ok, true);
  assert.equal(printed.ok && printed.value.stage, 'PRINTED');
  assert.ok(printed.ok && printed.value.printedAt !== null);
  assert.equal(printed.ok && printed.value.sentAt, null, 'printing must not imply sent');

  const replay = await advancePackageStage(
    { packageId: box.id, expectedVersion: box.version, stage: 'PACKED' },
    null,
  );
  assert.equal(replay.ok, false, 'a stale version loses');

  const audit = await db.auditEvent.findMany({ where: { entityType: 'Package', entityId: box.id } });
  assert.deepEqual(
    audit.map((event) => event.action).sort(),
    ['package.created', 'package.stage_changed'],
  );
});
