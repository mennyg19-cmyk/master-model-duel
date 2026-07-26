import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import {
  availableUnits,
  INSUFFICIENT_INVENTORY,
  releaseUnits,
  reserveUnits,
} from '../src/lib/inventory/reserve';
import { finalizeOrder } from '../src/lib/orders/order-service';
import {
  createCustomer,
  createDraftOrder,
  createFulfillmentMethod,
  createProduct,
  createSeason,
  db,
} from './fixtures';

after(() => db.$disconnect());

test('two checkouts race for the last package and only one commits', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const method = await createFulfillmentMethod();
  const lastOne = await createProduct(season, { onHand: 1 });

  const [first, second] = await Promise.all([
    createDraftOrder({ season, customer, lines: [{ product: lastOne, fulfillmentMethodId: method.id }] }),
    createDraftOrder({ season, customer, lines: [{ product: lastOne, fulfillmentMethodId: method.id }] }),
  ]);

  const attempts = await Promise.all([finalizeOrder(first.id, null), finalizeOrder(second.id, null)]);

  const winners = attempts.filter((attempt) => attempt.ok);
  const losers = attempts.filter((attempt) => !attempt.ok);

  assert.equal(winners.length, 1, 'exactly one checkout may take the last unit');
  assert.equal(losers.length, 1);
  assert.equal(losers[0].ok === false && losers[0].code, INSUFFICIENT_INVENTORY);

  const stock = await db.inventoryItem.findUniqueOrThrow({ where: { productId: lastOne.id } });
  assert.equal(stock.onHand, 1);
  assert.equal(stock.reserved, 1, 'the loser must not have reserved anything');

  const loserOrder = await db.order.findFirstOrThrow({
    where: { id: { in: [first.id, second.id] }, status: 'DRAFT' },
  });
  assert.equal(loserOrder.orderNumber, null, 'a rolled back checkout burns no order number');
});

test('five concurrent reservations for one unit produce one winner', async () => {
  const season = await createSeason();
  const product = await createProduct(season, { onHand: 1 });

  const attempts = await Promise.all(
    Array.from({ length: 5 }, () => reserveUnits(db, { productId: product.id }, 1)),
  );

  assert.equal(attempts.filter((attempt) => attempt.ok).length, 1);
  assert.equal(await availableUnits(db, { productId: product.id }), 0);
});

test('a reservation that cannot be met reports how many are left', async () => {
  const season = await createSeason();
  const product = await createProduct(season, { onHand: 3 });

  const tooMany = await reserveUnits(db, { productId: product.id }, 4);

  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.ok === false && tooMany.code, INSUFFICIENT_INVENTORY);
  assert.match(tooMany.ok === false ? tooMany.publicMessage : '', /Only 3 left/);
});

test('releasing hands the units back', async () => {
  const season = await createSeason();
  const product = await createProduct(season, { onHand: 10 });

  assert.equal((await reserveUnits(db, { productId: product.id }, 4)).ok, true);
  assert.equal(await availableUnits(db, { productId: product.id }), 6);

  assert.equal((await releaseUnits(db, { productId: product.id }, 4)).ok, true);
  assert.equal(await availableUnits(db, { productId: product.id }), 10);

  const never = await releaseUnits(db, { productId: product.id }, 1);
  assert.equal(never.ok, false, 'units that were never reserved cannot be released');
});

test('a stocked add-on is reserved alongside its product, each with its own record', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const method = await createFulfillmentMethod();
  const product = await createProduct(season, { onHand: 5 });

  const wine = await db.addOn.create({
    data: { seasonId: season.id, slug: `addon-${Date.now()}`, name: 'Extra bottle of wine', priceCents: 1800 },
  });
  await db.inventoryItem.create({ data: { addOnId: wine.id, onHand: 4 } });

  const draft = await createDraftOrder({
    season,
    customer,
    lines: [{ product, fulfillmentMethodId: method.id, quantity: 2 }],
  });
  const line = await db.orderLine.findFirstOrThrow({ where: { orderId: draft.id } });
  await db.orderLineAddOn.create({
    data: {
      orderLineId: line.id,
      addOnId: wine.id,
      quantity: 3,
      addOnNameSnapshot: wine.name,
      unitPriceCents: wine.priceCents,
      lineTotalCents: wine.priceCents * 3,
    },
  });

  assert.equal((await finalizeOrder(draft.id, null)).ok, true);

  const addOnStock = await db.inventoryItem.findUniqueOrThrow({ where: { addOnId: wine.id } });
  assert.equal(addOnStock.reserved, 3, 'the add-on holds its own stock, not the product\'s');

  const reservations = await db.reservation.findMany({
    where: { orderId: draft.id },
    orderBy: { quantity: 'asc' },
  });
  assert.deepEqual(
    reservations.map((reservation) => [reservation.productId, reservation.addOnId, reservation.quantity]),
    [
      [product.id, null, 2],
      [null, wine.id, 3],
    ],
  );
});

test('the database refuses an inventory row that counts two things at once', async () => {
  const season = await createSeason();
  const product = await createProduct(season, { onHand: 5 });
  const addOn = await db.addOn.create({
    data: { seasonId: season.id, slug: `addon-${Date.now()}`, name: 'Test add-on', priceCents: 100 },
  });

  await assert.rejects(
    db.$executeRaw`
      INSERT INTO "InventoryItem" ("id", "productId", "addOnId", "onHand", "reserved", "updatedAt")
      VALUES ('xor-check-probe', ${product.id}, ${addOn.id}, 1, 0, NOW())`,
    /InventoryItem_single_target/,
  );
});

test('the database refuses to reserve more than is on hand', async () => {
  const season = await createSeason();
  const product = await createProduct(season, { onHand: 2 });

  await assert.rejects(
    db.$executeRaw`UPDATE "InventoryItem" SET "reserved" = 3 WHERE "productId" = ${product.id}`,
    /InventoryItem_reserved_within_on_hand/,
  );
});
