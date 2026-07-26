import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { CONCURRENT_CHANGE, finalizeOrder } from '../src/lib/orders/order-service';
import { ILLEGAL_TRANSITION } from '../src/lib/orders/state-machine';
import {
  createCustomer,
  createDraftOrder,
  createFulfillmentMethod,
  createProduct,
  createSeason,
  db,
} from './fixtures';

const CONCURRENT_CHECKOUTS = 10;

after(() => db.$disconnect());

test('ten concurrent checkouts claim unique sequential order numbers', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const method = await createFulfillmentMethod();
  const product = await createProduct(season, { onHand: CONCURRENT_CHECKOUTS });

  const drafts = await Promise.all(
    Array.from({ length: CONCURRENT_CHECKOUTS }, () =>
      createDraftOrder({ season, customer, lines: [{ product, fulfillmentMethodId: method.id }] }),
    ),
  );

  const results = await Promise.all(drafts.map((draft) => finalizeOrder(draft.id, null)));

  const numbers = results.map((result) => (result.ok ? result.value.orderNumber : null));
  assert.ok(
    numbers.every((number) => number !== null),
    `every checkout should succeed, got ${JSON.stringify(numbers)}`,
  );

  assert.deepEqual(
    [...numbers].sort((left, right) => Number(left) - Number(right)),
    Array.from({ length: CONCURRENT_CHECKOUTS }, (_unused, index) => index + 1),
    'the numbers must be 1..10 with no repeats and no gaps',
  );

  const seasonAfter = await db.season.findUniqueOrThrow({ where: { id: season.id } });
  assert.equal(seasonAfter.nextOrderNumber, CONCURRENT_CHECKOUTS + 1);
});

test('two finalizations of the same order place it once and burn one number', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const method = await createFulfillmentMethod();
  const product = await createProduct(season, { onHand: 10 });

  const draft = await createDraftOrder({
    season,
    customer,
    lines: [{ product, fulfillmentMethodId: method.id }],
  });

  const attempts = await Promise.all([finalizeOrder(draft.id, null), finalizeOrder(draft.id, null)]);

  assert.equal(attempts.filter((attempt) => attempt.ok).length, 1);

  // Which failure the loser gets depends on whether it read the order before or
  // after the winner committed. Both answers are correct refusals.
  const loser = attempts.find((attempt) => !attempt.ok);
  assert.ok(
    loser?.ok === false && [CONCURRENT_CHANGE, ILLEGAL_TRANSITION].includes(loser.code),
    `unexpected refusal: ${loser?.ok === false ? loser.code : 'none'}`,
  );

  const placed = await db.order.findUniqueOrThrow({ where: { id: draft.id } });
  assert.equal(placed.status, 'PLACED');
  assert.equal(placed.orderNumber, 1);

  const seasonAfter = await db.season.findUniqueOrThrow({ where: { id: season.id } });
  assert.equal(seasonAfter.nextOrderNumber, 2, 'the loser must not consume a number');

  const stock = await db.inventoryItem.findUniqueOrThrow({ where: { productId: product.id } });
  assert.equal(stock.reserved, 1, 'the loser must not reserve a second unit');
});
