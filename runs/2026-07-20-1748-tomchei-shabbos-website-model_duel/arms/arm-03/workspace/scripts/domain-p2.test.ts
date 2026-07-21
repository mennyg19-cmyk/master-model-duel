import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { OrderStatus, PackageStage } from "@prisma/client";
import { db } from "../src/lib/db";
import { buildGroupingKey, groupLinesByKey } from "../src/lib/orders/grouping";
import {
  assertOrderTransition,
  canTransitionOrder,
} from "../src/lib/orders/state-machine";
import { formatDraftRef } from "../src/lib/orders/draft-wire";
import { finalizeOrder } from "../src/lib/orders/finalize";
import { transitionPackage } from "../src/lib/orders/package-stages";
import { reserveInventory } from "../src/lib/inventory/reserve";
import { assertInventoryTargetXor } from "../src/lib/inventory/target-xor";

function testGrouping() {
  const base = {
    recipientName: "Rivky Cohen",
    addressLine1: "200 Ocean Pkwy",
    city: "Brooklyn",
    state: "NY",
    postalCode: "11218",
    country: "US",
    fulfillmentMethodCode: "SHIP",
  };

  const sameA = buildGroupingKey({ ...base, greeting: "Chag Sameach" });
  const sameB = buildGroupingKey({ ...base, greeting: "Chag Sameach" });
  const split = buildGroupingKey({ ...base, greeting: "Different greeting" });

  assert.equal(sameA, sameB, "identical recipient/address/method/greeting must share key");
  assert.notEqual(sameA, split, "different greeting must split packages");

  const groups = groupLinesByKey([
    { id: "1", groupingKey: sameA },
    { id: "2", groupingKey: sameB },
    { id: "3", groupingKey: split },
  ]);
  assert.equal(groups.get(sameA)?.length, 2);
  assert.equal(groups.get(split)?.length, 1);
  console.log("grouping unit tests: ok");
}

function testStateMachine() {
  assert.equal(canTransitionOrder(OrderStatus.DRAFT, OrderStatus.PLACED), true);
  assert.equal(canTransitionOrder(OrderStatus.DRAFT, OrderStatus.DISCARDED), true);
  assert.equal(canTransitionOrder(OrderStatus.DRAFT, OrderStatus.PAID), false);
  assert.equal(canTransitionOrder(OrderStatus.COMPLETED, OrderStatus.DRAFT), false);

  assert.throws(
    () => assertOrderTransition(OrderStatus.PLACED, OrderStatus.DRAFT),
    /Illegal order transition/,
  );
  console.log("state machine unit tests: ok");
}

function testInventoryXor() {
  assert.throws(
    () => assertInventoryTargetXor({ productId: null, addOnId: null }),
    /XOR violated/,
  );
  assert.throws(
    () => assertInventoryTargetXor({ productId: "p1", addOnId: "a1" }),
    /XOR violated/,
  );
  assertInventoryTargetXor({ productId: "p1", addOnId: null });
  assertInventoryTargetXor({ productId: null, addOnId: "a1" });
  console.log("inventory XOR unit tests: ok");
}

async function ensureInventoryHeadroom(productId: string, units: number) {
  assertInventoryTargetXor({ productId, addOnId: null });
  await db.inventoryItem.upsert({
    where: { productId },
    create: {
      productId,
      onHand: units,
      reserved: 0,
      version: 1,
    },
    update: {
      onHand: units,
      reserved: 0,
    },
  });
}

async function createDraft(opts: {
  seasonId: string;
  year: number;
  customerId: string;
  productId: string;
  unitPriceCents: number;
  methodId: string;
  methodCode: string;
  suffix: string;
  recipientName: string;
  addressLine1: string;
}) {
  const draftRef = formatDraftRef(
    opts.year,
    `${opts.suffix}${randomBytes(4).toString("hex")}`,
  );
  const greeting = "Concurrent finalize";
  const groupingKey = buildGroupingKey({
    recipientName: opts.recipientName,
    addressLine1: opts.addressLine1,
    city: "Brooklyn",
    state: "NY",
    postalCode: "11218",
    fulfillmentMethodCode: opts.methodCode,
    greeting,
  });
  return db.order.create({
    data: {
      seasonId: opts.seasonId,
      customerId: opts.customerId,
      status: OrderStatus.DRAFT,
      draftRef,
      greetingDefault: greeting,
      lines: {
        create: {
          productId: opts.productId,
          quantity: 1,
          unitPriceCents: opts.unitPriceCents,
          recipientName: opts.recipientName,
          addressLine1: opts.addressLine1,
          city: "Brooklyn",
          state: "NY",
          postalCode: "11218",
          fulfillmentMethodId: opts.methodId,
          greeting,
          groupingKey,
        },
      },
    },
  });
}

async function testConcurrentFinalizations() {
  const season = await db.season.findUniqueOrThrow({ where: { slug: "purim-2026" } });
  const customer = await db.customer.findUniqueOrThrow({
    where: { email: "customer@tomchei.local" },
  });
  const product = await db.product.findFirstOrThrow({
    where: { seasonId: season.id, sku: "FAMILY-BOX" },
  });
  const method = await db.fulfillmentMethod.findUniqueOrThrow({
    where: { code: "SHIP" },
  });

  await ensureInventoryHeadroom(product.id, 50);

  const drafts = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      createDraft({
        seasonId: season.id,
        year: season.year,
        customerId: customer.id,
        productId: product.id,
        unitPriceCents: product.basePriceCents,
        methodId: method.id,
        methodCode: method.code,
        suffix: `CF${index}`,
        recipientName: `Recipient ${index}`,
        addressLine1: `${100 + index} Test Ave`,
      }),
    ),
  );

  const results = await Promise.all(drafts.map((draft) => finalizeOrder(draft.id)));
  const successes = results.filter((row) => row.ok);
  const failures = results.filter((row) => !row.ok);

  assert.equal(successes.length, 8, `expected 8 finalizations, got ${successes.length}`);
  assert.equal(failures.length, 0);

  const numbers = successes.map((row) => {
    assert.equal(row.ok, true);
    return row.value.orderNumber;
  });
  const unique = new Set(numbers);
  assert.equal(unique.size, numbers.length, "order numbers must be unique");
  const sorted = [...numbers].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) {
    assert.equal(sorted[i], sorted[i - 1] + 1, "order numbers must be sequential");
  }

  for (const draft of drafts) {
    const packages = await db.package.findMany({ where: { orderId: draft.id } });
    assert.equal(packages.length, 1, `order ${draft.id} must materialize one package`);
  }

  console.log(
    JSON.stringify({
      concurrentFinalize: "ok",
      orderNumbers: sorted,
      packagesMaterialized: drafts.length,
    }),
  );
}

async function testSameDraftContention() {
  const season = await db.season.findUniqueOrThrow({ where: { slug: "purim-2026" } });
  const customer = await db.customer.findUniqueOrThrow({
    where: { email: "customer@tomchei.local" },
  });
  const product = await db.product.findFirstOrThrow({
    where: { seasonId: season.id, sku: "FAMILY-BOX" },
  });
  const method = await db.fulfillmentMethod.findUniqueOrThrow({
    where: { code: "SHIP" },
  });

  await ensureInventoryHeadroom(product.id, 10);

  const draft = await createDraft({
    seasonId: season.id,
    year: season.year,
    customerId: customer.id,
    productId: product.id,
    unitPriceCents: product.basePriceCents,
    methodId: method.id,
    methodCode: method.code,
    suffix: "SD",
    recipientName: "Same Draft",
    addressLine1: "1 Contention St",
  });

  const before = await db.season.findUniqueOrThrow({ where: { id: season.id } });
  const results = await Promise.all([
    finalizeOrder(draft.id),
    finalizeOrder(draft.id),
  ]);
  const winners = results.filter((row) => row.ok);
  const losers = results.filter((row) => !row.ok);
  assert.equal(winners.length, 1, "only one finalize may win the same draft");
  assert.equal(losers.length, 1, "losing same-draft finalize must fail");

  const after = await db.season.findUniqueOrThrow({ where: { id: season.id } });
  assert.equal(
    after.nextOrderNumber,
    before.nextOrderNumber + 1,
    "losing contention must not burn an order number",
  );

  const packages = await db.package.count({ where: { orderId: draft.id } });
  assert.equal(packages, 1);

  console.log(
    JSON.stringify({
      sameDraftContention: "ok",
      nextOrderNumberAdvancedBy: 1,
    }),
  );
}

async function testPackageStageTransition() {
  const pkg = await db.package.findFirst({
    where: { stage: PackageStage.NEW },
    include: { order: { select: { seasonId: true } } },
    orderBy: { createdAt: "desc" },
  });
  assert.ok(pkg, "need a NEW package from finalize tests");
  const seasonId = pkg.order.seasonId;

  const first = await transitionPackage(seasonId, pkg.id, PackageStage.PRINTED);
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const stale = await transitionPackage(
    seasonId,
    pkg.id,
    PackageStage.PACKED,
    null,
    pkg.version,
  );
  assert.equal(stale.ok, false, "stale version must fail");

  const second = await transitionPackage(
    seasonId,
    pkg.id,
    PackageStage.PACKED,
    null,
    first.value.package.version,
  );
  assert.equal(second.ok, true);

  console.log(JSON.stringify({ packageStageTransition: "ok" }));
}

async function testInventoryRace() {
  const product = await db.product.findFirstOrThrow({
    where: { sku: "FAMILY-BOX" },
  });

  assertInventoryTargetXor({ productId: product.id, addOnId: null });
  const item = await db.inventoryItem.upsert({
    where: { productId: product.id },
    create: {
      productId: product.id,
      onHand: 1,
      reserved: 0,
      version: 1,
    },
    update: {
      onHand: 1,
      reserved: 0,
      version: 1,
    },
  });

  const results = await Promise.all([
    reserveInventory({ inventoryItemId: item.id, quantity: 1 }),
    reserveInventory({ inventoryItemId: item.id, quantity: 1 }),
  ]);

  const winners = results.filter((row) => row.ok);
  const losers = results.filter((row) => !row.ok);
  assert.equal(winners.length, 1, "only one checkout may claim the last unit");
  assert.equal(losers.length, 1, "losing reservation must fail");

  const latest = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(latest.reserved, 1);
  assert.equal(latest.onHand, 1);

  console.log(
    JSON.stringify({
      inventoryRace: "ok",
      reserved: latest.reserved,
      version: latest.version,
    }),
  );
}

async function main() {
  testGrouping();
  testStateMachine();
  testInventoryXor();
  await testConcurrentFinalizations();
  await testSameDraftContention();
  await testPackageStageTransition();
  await testInventoryRace();
  console.log("domain-p2 tests: all ok");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
