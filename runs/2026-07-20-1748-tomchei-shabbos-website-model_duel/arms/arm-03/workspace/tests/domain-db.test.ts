import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../lib/db";
import { finalizeOrder, discardOrder } from "../lib/domain/finalize";
import { reserveInventory } from "../lib/domain/inventory";
import { newDraftReference } from "../lib/domain/draft-reference";

// DB-backed tests (require the dev Postgres on 4102). Each run builds its own
// season/customer/product under a unique tag and deletes them afterwards, so
// reruns and the seed never collide.
const tag = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let seasonId: string;
let customerId: string;
let productId: string;
let methodId: string;

before(async () => {
  const season = await db.season.create({ data: { name: `Season ${tag}`, status: "OPEN" } });
  seasonId = season.id;
  const customer = await db.customer.create({
    data: { email: `${tag}@example.com`, name: "Test Customer" },
  });
  customerId = customer.id;
  const method = await db.fulfillmentMethod.create({
    data: { code: `method-${tag}`, name: "Test Method" },
  });
  methodId = method.id;
  const product = await db.product.create({
    data: { seasonId, name: `Basket ${tag}`, slug: `basket-${tag}`, basePriceCents: 1000 },
  });
  productId = product.id;
});

after(async () => {
  await db.orderLine.deleteMany({ where: { order: { seasonId } } });
  await db.order.deleteMany({ where: { seasonId } });
  await db.package.deleteMany({ where: { seasonId } });
  await db.inventoryItem.deleteMany({ where: { product: { seasonId } } });
  await db.product.deleteMany({ where: { seasonId } });
  await db.fulfillmentMethod.delete({ where: { id: methodId } });
  await db.customer.delete({ where: { id: customerId } });
  await db.season.delete({ where: { id: seasonId } });
  await db.$disconnect();
});

function draftOrderData(greeting: string) {
  return {
    seasonId,
    customerId,
    draftReference: newDraftReference(),
    totalCents: 1000,
    lines: {
      create: {
        productId,
        unitPriceCents: 1000,
        recipientName: "Recipient One",
        addressLine1: "1 Elm St",
        city: "Lakewood",
        state: "NJ",
        zip: "08701",
        fulfillmentMethodId: methodId,
        greeting,
      },
    },
  };
}

test("concurrent finalizations claim unique sequential order numbers", async () => {
  const orders = await Promise.all(
    Array.from({ length: 5 }, () => db.order.create({ data: draftOrderData("Hi") }))
  );
  const finalized = await Promise.all(orders.map((order) => finalizeOrder(order.id)));
  const numbers = finalized.map((order) => order.orderNumber).sort((a, b) => a! - b!);
  assert.deepEqual(numbers, [1, 2, 3, 4, 5], "expected 5 distinct sequential numbers");
});

test("double finalize of the same order: exactly one wins", async () => {
  const order = await db.order.create({ data: draftOrderData("Hi") });
  const outcomes = await Promise.allSettled([finalizeOrder(order.id), finalizeOrder(order.id)]);
  const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
  assert.equal(fulfilled.length, 1, "exactly one finalize should commit");

  // A4: the losing finalize must not burn a number — the season counter stays
  // exactly equal to the count of finalized orders (no gap).
  const season = await db.season.findUniqueOrThrow({ where: { id: seasonId } });
  const finalizedCount = await db.order.count({ where: { seasonId, status: "FINALIZED" } });
  assert.equal(season.orderCounter, finalizedCount, "order counter must stay gap-free");
});

test("concurrent finalizations of different orders sharing a key merge into one package", async () => {
  const greeting = "Race greeting";
  const [first, second] = await Promise.all([
    db.order.create({ data: draftOrderData(greeting) }),
    db.order.create({ data: draftOrderData(greeting) }),
  ]);
  await Promise.all([finalizeOrder(first.id), finalizeOrder(second.id)]);

  const packages = await db.package.findMany({
    where: { seasonId, greeting, stage: "NEW" },
    include: { lines: true },
  });
  assert.equal(packages.length, 1, "racing finalizes must not create duplicate NEW packages");
  assert.equal(packages[0].lines.length, 2, "both orders' lines should share the package");
});

test("finalize after discard is rejected by the state machine", async () => {
  const order = await db.order.create({ data: draftOrderData("Hi") });
  await discardOrder(order.id);
  await assert.rejects(finalizeOrder(order.id), /Illegal order transition/);
});

test("same grouping key merges packages across orders; different greeting splits", async () => {
  const first = await db.order.create({ data: draftOrderData("Shared greeting") });
  const second = await db.order.create({ data: draftOrderData("Shared greeting") });
  const third = await db.order.create({ data: draftOrderData("Different greeting") });
  await finalizeOrder(first.id);
  await finalizeOrder(second.id);
  await finalizeOrder(third.id);

  const packages = await db.package.findMany({
    where: { seasonId, recipientName: "Recipient One" },
    include: { lines: true, auditEntries: true },
  });
  const merged = packages.find((pkg) => pkg.greeting === "Shared greeting");
  const split = packages.find((pkg) => pkg.greeting === "Different greeting");
  assert.ok(merged && merged.lines.length === 2, "shared-greeting lines should share a package");
  assert.ok(split && split.lines.length === 1, "different greeting should get its own package");
  assert.ok(merged!.auditEntries.length >= 2, "merge should be audited");
});

test("two concurrent reservations for the last unit: only one commits", async () => {
  const item = await db.inventoryItem.create({ data: { productId, quantityOnHand: 1 } });
  const results = await Promise.all([
    db.$transaction((tx) => reserveInventory(tx, item.id, 1)),
    db.$transaction((tx) => reserveInventory(tx, item.id, 1)),
  ]);
  assert.deepEqual(results.filter(Boolean).length, 1, "exactly one reservation should win");
  const finalItem = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(finalItem.reserved, 1);
});

test("finalize reserves tracked inventory and rejects when stock runs out", async () => {
  const trackedProduct = await db.product.create({
    data: {
      seasonId,
      name: `Tracked ${tag}`,
      slug: `tracked-${tag}`,
      basePriceCents: 2000,
      trackInventory: true,
      inventoryItem: { create: { quantityOnHand: 1 } },
    },
    include: { inventoryItem: true },
  });
  const orderData = (greeting: string) => ({
    ...draftOrderData(greeting),
    lines: {
      create: {
        productId: trackedProduct.id,
        unitPriceCents: 2000,
        recipientName: "Recipient Two",
        addressLine1: "2 Oak St",
        city: "Lakewood",
        state: "NJ",
        zip: "08701",
        fulfillmentMethodId: methodId,
        greeting,
      },
    },
  });

  const winner = await db.order.create({ data: orderData("First") });
  await finalizeOrder(winner.id);
  const afterWin = await db.inventoryItem.findUniqueOrThrow({
    where: { id: trackedProduct.inventoryItem!.id },
  });
  assert.equal(afterWin.reserved, 1, "finalize should reserve the tracked unit");

  const loser = await db.order.create({ data: orderData("Second") });
  await assert.rejects(finalizeOrder(loser.id), /Insufficient stock/);
  const loserAfter = await db.order.findUniqueOrThrow({ where: { id: loser.id } });
  assert.equal(loserAfter.status, "DRAFT", "failed finalize must roll back the status flip");
  assert.equal(loserAfter.orderNumber, null, "failed finalize must not keep a number");
});

test("inventory XOR constraint rejects an item with both targets or neither", async () => {
  await assert.rejects(
    db.$executeRaw`INSERT INTO "InventoryItem" ("id", "quantityOnHand") VALUES (${`xor-${tag}`}, 5)`,
    /InventoryItem_target_xor/
  );
});
