import assert from "node:assert/strict";
import test from "node:test";
import {
  OrderStatus,
  PackageStage,
  PrismaClient,
  ProductKind,
} from "@prisma/client";
import {
  createPackageGroupingKey,
  groupLinesIntoPackages,
} from "../src/domain/package-grouping";
import {
  assertOrderTransition,
  discardDraft,
  finalizeOrder,
  formatDraftReference,
} from "../src/domain/order-engine";
import { reserveInventory } from "../src/domain/inventory";
import { advancePackageStage } from "../src/domain/package-stage";

if (!process.env.DATABASE_URL) {
  process.loadEnvFile(".env");
}

const prisma = new PrismaClient();
const secondClient = new PrismaClient();
const testDraftPrefix = "D-P2-TEST-";

async function getDatabaseFixture() {
  const season = await prisma.season.upsert({
    where: { year: 2099 },
    update: {},
    create: { name: "P2 Integration Test", year: 2099 },
  });
  const customer = await prisma.customer.upsert({
    where: { emailNormalized: "p2-integration@example.test" },
    update: {},
    create: {
      displayName: "P2 Integration Test",
      email: "p2-integration@example.test",
      emailNormalized: "p2-integration@example.test",
    },
  });
  const fulfillmentMethod = await prisma.fulfillmentMethod.upsert({
    where: { seasonId_code: { seasonId: season.id, code: "P2_TEST" } },
    update: {},
    create: {
      seasonId: season.id,
      code: "P2_TEST",
      displayName: "P2 test delivery",
    },
  });

  return { season, customer, fulfillmentMethod };
}

test.before(async () => {
  await prisma.order.deleteMany({
    where: { draftReference: { startsWith: testDraftPrefix } },
  });
});

test.after(async () => {
  await prisma.order.deleteMany({
    where: { draftReference: { startsWith: testDraftPrefix } },
  });
  await Promise.all([prisma.$disconnect(), secondClient.$disconnect()]);
});

const sharedPackageFields = {
  recipientName: "Leah Cohen",
  addressKey: "15 Main St|Lakewood|NJ|08701",
  fulfillmentMethodCode: "delivery",
  greeting: "A freilichen Purim!",
};

test("package grouping combines identical recipient, address, method, and greeting", () => {
  const packages = groupLinesIntoPackages([
    { ...sharedPackageFields, lineId: "line-1", quantity: 1 },
    { ...sharedPackageFields, lineId: "line-2", quantity: 2 },
  ]);

  assert.equal(packages.length, 1);
  assert.deepEqual(
    packages[0].lines.map(({ lineId }) => lineId),
    ["line-1", "line-2"],
  );
});

test("package grouping splits otherwise identical lines with different greetings", () => {
  const packages = groupLinesIntoPackages([
    { ...sharedPackageFields, lineId: "line-1", quantity: 1 },
    {
      ...sharedPackageFields,
      greeting: "With warm wishes",
      lineId: "line-2",
      quantity: 1,
    },
  ]);

  assert.equal(packages.length, 2);
  assert.notEqual(packages[0].groupingKey, packages[1].groupingKey);
});

test("grouping key normalizes harmless whitespace and casing differences", () => {
  assert.equal(
    createPackageGroupingKey(sharedPackageFields),
    createPackageGroupingKey({
      ...sharedPackageFields,
      recipientName: "  LEAH   COHEN ",
      greeting: " A FREILICHEN PURIM! ",
    }),
  );
});

test("order state machine rejects illegal transitions", () => {
  assert.throws(
    () => assertOrderTransition(OrderStatus.FINALIZED, OrderStatus.DRAFT),
    /cannot transition/,
  );
  assert.doesNotThrow(() =>
    assertOrderTransition(OrderStatus.DRAFT, OrderStatus.FINALIZED),
  );
});

test("draft references use the stable wire format", () => {
  assert.equal(formatDraftReference(42), "D-00000042");
});

test("concurrent finalizations receive unique sequential order numbers in the database", async () => {
  const { season, customer } = await getDatabaseFixture();
  await prisma.season.update({
    where: { id: season.id },
    data: { nextOrderNumber: 900_000 },
  });
  const orders = await Promise.all(
    ["ORDER-A", "ORDER-B"].map((suffix) =>
      prisma.order.create({
        data: {
          seasonId: season.id,
          customerId: customer.id,
          draftReference: `${testDraftPrefix}${suffix}`,
        },
      }),
    ),
  );
  const orderNumbers = await Promise.all([
    finalizeOrder(prisma, orders[0].id),
    finalizeOrder(secondClient, orders[1].id),
  ]);

  assert.deepEqual([...orderNumbers].sort((left, right) => left - right), [
    900_000,
    900_001,
  ]);
  assert.equal(new Set(orderNumbers).size, orderNumbers.length);
});

test("two database reservations for the last finished package allow only one winner", async () => {
  const { season } = await getDatabaseFixture();
  const product = await prisma.product.upsert({
    where: { seasonId_sku: { seasonId: season.id, sku: "P2-RACE" } },
    update: {},
    create: {
      seasonId: season.id,
      sku: "P2-RACE",
      name: "P2 race product",
      kind: ProductKind.PACKAGE,
      priceCents: 100,
      isFinishedPackage: true,
    },
  });
  const inventory = await prisma.inventoryItem.upsert({
    where: { productId: product.id },
    update: { onHand: 1, reserved: 0 },
    create: {
      targetKind: "PRODUCT",
      productId: product.id,
      onHand: 1,
    },
  });
  const reservations = await Promise.allSettled([
    reserveInventory(prisma, inventory.id, 1),
    reserveInventory(secondClient, inventory.id, 1),
  ]);

  assert.equal(
    reservations.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  assert.equal(
    reservations.filter(({ status }) => status === "rejected").length,
    1,
  );
});

test("discardDraft persists the cancelled state and version", async () => {
  const { season, customer } = await getDatabaseFixture();
  const order = await prisma.order.create({
    data: {
      seasonId: season.id,
      customerId: customer.id,
      draftReference: `${testDraftPrefix}DISCARD`,
    },
  });

  await discardDraft(prisma, order.id);

  const discarded = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
  });
  assert.equal(discarded.status, OrderStatus.CANCELLED);
  assert.equal(discarded.version, 2);
  assert.ok(discarded.discardedAt);
  await assert.rejects(() => discardDraft(prisma, order.id), /existing draft/);
});

test("package stage updates enforce versions and write an audit", async () => {
  const { season, customer, fulfillmentMethod } = await getDatabaseFixture();
  const order = await prisma.order.create({
    data: {
      seasonId: season.id,
      customerId: customer.id,
      draftReference: `${testDraftPrefix}PACKAGE`,
    },
  });
  const packageRecord = await prisma.package.create({
    data: {
      orderId: order.id,
      fulfillmentMethodId: fulfillmentMethod.id,
      recipientName: "P2 Recipient",
      greetingSnapshot: "P2 greeting",
      groupingKey: "p2-package",
    },
  });

  await advancePackageStage(
    prisma,
    packageRecord.id,
    packageRecord.version,
    PackageStage.PRINTED,
  );

  const updatedPackage = await prisma.package.findUniqueOrThrow({
    where: { id: packageRecord.id },
  });
  assert.equal(updatedPackage.stage, PackageStage.PRINTED);
  assert.equal(updatedPackage.version, 2);
  assert.equal(
    await prisma.packageAudit.count({ where: { packageId: packageRecord.id } }),
    1,
  );
  await assert.rejects(
    () =>
      advancePackageStage(
        prisma,
        packageRecord.id,
        packageRecord.version,
        PackageStage.PACKED,
      ),
    /concurrent mutation/,
  );
});
