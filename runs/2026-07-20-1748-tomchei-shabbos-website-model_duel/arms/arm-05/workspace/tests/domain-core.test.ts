import assert from "node:assert/strict";
import test from "node:test";
import { reserveInventory } from "../lib/inventory";
import { assertOrderTransition, discardOrder, finalizeOrder } from "../lib/orders";
import { groupPackageCandidates } from "../lib/packages";
import { createPdf } from "../lib/print-batches";
import { prisma } from "../lib/db";

test("grouping key uses recipient, address, fulfillment method, and greeting", () => {
  const groups = groupPackageCandidates([
    { recipientKey: "rachel", addressId: "address-1", fulfillmentMethodId: "delivery", greeting: "Happy Purim" },
    { recipientKey: "rachel", addressId: "address-1", fulfillmentMethodId: "delivery", greeting: "Happy Purim" },
    { recipientKey: "rachel", addressId: "address-1", fulfillmentMethodId: "delivery", greeting: "Purim Sameach" },
    { recipientKey: "lea", addressId: "address-1", fulfillmentMethodId: "delivery", greeting: "Happy Purim" },
    { recipientKey: "rachel", addressId: "address-2", fulfillmentMethodId: "delivery", greeting: "Happy Purim" },
    { recipientKey: "rachel", addressId: "address-1", fulfillmentMethodId: "pickup", greeting: "Happy Purim" },
  ]);

  assert.equal(groups.length, 5);
  assert.equal(groups[0].candidates.length, 2);
  assert.equal(groups[1].candidates.length, 1);
});

test("order state machine rejects illegal transitions", () => {
  assert.throws(
    () => assertOrderTransition("FINALIZED", "DISCARDED"),
    /Cannot transition an order from FINALIZED to DISCARDED/,
  );
});

test("PDF output keeps lines after the first page", () => {
  const pdf = createPdf({ title: "Packing slips", lines: Array.from({ length: 56 }, (_, index) => `Package ${index + 1}`) }).toString("utf8");

  assert.match(pdf, /\/Count 2/);
  assert.match(pdf, /Package 56/);
});

test("concurrent finalizations claim unique seasonal order numbers", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const season = await prisma.season.create({
    data: { name: "Finalization fixture", year: 300000 + Math.floor(Math.random() * 100000), status: "OPEN" },
  });
  const orders = await Promise.all(
    ["one", "two"].map((suffix) => prisma.order.create({
      data: {
        seasonId: season.id,
        draftReference: `DRAFT-FINALIZE-${crypto.randomUUID()}-${suffix}`,
        wireFormat: { version: 1 },
      },
    })),
  );

  const finalized = await Promise.all(orders.map((order) => finalizeOrder(order.id)));
  assert.deepEqual(finalized.map((order) => order.orderNumber).sort(), [1, 2]);
});

test("only one draft transition wins when finalization races discarding", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const season = await prisma.season.create({
    data: { name: "Discard fixture", year: 350000 + Math.floor(Math.random() * 100000), status: "OPEN" },
  });
  const order = await prisma.order.create({
    data: {
      seasonId: season.id,
      draftReference: `DRAFT-DISCARD-${crypto.randomUUID()}`,
      wireFormat: { version: 1 },
    },
  });

  const transitions = await Promise.allSettled([finalizeOrder(order.id), discardOrder(order.id)]);
  const savedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });

  assert.equal(transitions.filter(({ status }) => status === "fulfilled").length, 1);
  assert.ok(["FINALIZED", "DISCARDED"].includes(savedOrder.status));
});

test("closed seasons reject finalization", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const season = await prisma.season.create({
    data: { name: "Closed fixture", year: 375000 + Math.floor(Math.random() * 100000) },
  });
  const order = await prisma.order.create({
    data: {
      seasonId: season.id,
      draftReference: `DRAFT-CLOSED-${crypto.randomUUID()}`,
      wireFormat: { version: 1 },
    },
  });

  await assert.rejects(
    finalizeOrder(order.id),
    /Order season must be OPEN before finalization; current status is CLOSED/,
  );
});

test("last finished-package inventory unit is reserved once", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const season = await prisma.season.create({
    data: { name: "Inventory fixture", year: 400000 + Math.floor(Math.random() * 100000) },
  });
  const product = await prisma.product.create({
    data: {
      seasonId: season.id,
      sku: `INVENTORY-${crypto.randomUUID()}`,
      name: "Finished package",
      priceCents: 2500,
    },
  });
  const inventory = await prisma.inventoryItem.create({
    data: { productId: product.id, quantityOnHand: 1 },
  });

  const attempts = await Promise.all([
    reserveInventory(inventory.id, 1),
    reserveInventory(inventory.id, 1),
  ]);
  const refreshed = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventory.id } });

  assert.equal(attempts.filter(Boolean).length, 1);
  assert.equal(refreshed.quantityReserved, 1);
});
