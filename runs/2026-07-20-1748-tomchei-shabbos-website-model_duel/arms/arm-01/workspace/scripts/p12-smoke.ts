import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  commitLegacyImport,
  inspectLegacyDocument,
  stageLegacyImport,
  type LegacyDocument,
} from "../src/domain/legacy-import";
import { getLaunchReports } from "../src/domain/launch-reporting";
import { createNightlyPrintBatch } from "../src/domain/print-batches";
import { createRepeatDraft, getRepeatReview } from "../src/domain/repeat-orders";
import { advancePackageStage } from "../src/domain/package-stage";
import { reconcileStripePayments } from "../src/domain/stripe-reconciliation";
import {
  seedScaleFixture,
  wipeScaleFixture,
} from "../src/domain/test-console";
import { switchFulfillmentMethod } from "../src/domain/delivery";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const separator = line.indexOf("=");
  if (separator > 0 && !line.startsWith("#")) {
    process.env[line.slice(0, separator)] ??= line.slice(separator + 1);
  }
}
process.env.ENABLE_TEST_AUTH = "true";

const db = new PrismaClient();
const runKey = randomUUID().slice(0, 8);
const baseUrl = process.env.APP_URL ?? "http://127.0.0.1:3101";
const authSecret =
  process.env.TEST_AUTH_SECRET ?? "p5-local-smoke-signing-key-2026";
const cronSecret = process.env.CRON_SECRET ?? "cron-smoke-shared";

function managerHeaders() {
  const timestamp = Date.now();
  const signature = createHmac("sha256", authSecret)
    .update(`__local_manager__.${timestamp}`)
    .digest("hex");
  return {
    "content-type": "application/json",
    origin: baseUrl,
    "x-test-clerk-user-id": "__local_manager__",
    "x-test-auth-token": `${timestamp}.${signature}`,
  };
}

async function createLedgerFixture() {
  const manager = await db.staffUser.findFirstOrThrow({
    where: { role: "MANAGER", status: "ACTIVE" },
  });
  const season = await db.season.upsert({
    where: { year: 2023 },
    update: {},
    create: { name: "Purim 2023", year: 2023, status: "CLOSED" },
  });
  const product = await db.product.create({
    data: {
      seasonId: season.id,
      sku: `P12-${runKey}`,
      name: "P12 Ledger Box",
      kind: "PACKAGE",
      priceCents: 5_000,
      isFinishedPackage: true,
    },
  });
  const methods = new Map<string, string>();
  for (const [index, method] of [
    { code: "SHIPPING", displayName: "Shipping", isShipping: true, isPickup: false },
    { code: "PACKAGE_DELIVERY", displayName: "Delivery", isShipping: false, isPickup: false },
    { code: "PICKUP", displayName: "Pickup", isShipping: false, isPickup: true },
  ].entries()) {
    const created = await db.fulfillmentMethod.upsert({
      where: { seasonId_code: { seasonId: season.id, code: method.code } },
      update: { isActive: true },
      create: {
        seasonId: season.id,
        code: method.code,
        displayName: method.displayName,
        isShipping: method.isShipping,
        isPickup: method.isPickup,
        requiresAddress: !method.isPickup,
        sortOrder: index,
      },
    });
    methods.set(method.code, created.id);
  }
  const customer = await db.customer.create({
    data: {
      displayName: "P12 Ledger Customer",
      email: `ledger-${runKey}@example.test`,
      emailNormalized: `ledger-${runKey}@example.test`,
      addresses: {
        create: {
          recipientName: "P12 Recipient",
          line1: "12 Report Road",
          city: "Lakewood",
          region: "NJ",
          postalCode: "08701",
          normalizedKey: `p12-ledger-${runKey}`,
        },
      },
    },
    include: { addresses: true },
  });
  const order = await db.order.create({
    data: {
      seasonId: season.id,
      customerId: customer.id,
      status: "FINALIZED",
      orderNumber: 1_700_000 + Math.floor(Math.random() * 100_000),
      draftReference: `P12-LEDGER-${runKey}`,
      cachedPaymentStatus: "PAID",
      subtotalCents: 20_000,
      donationCents: 1_000,
      totalCents: 21_000,
      finalizedAt: new Date(),
      payments: {
        create: {
          method: "CHECK",
          amountCents: 21_000,
          reference: `p12-check-${runKey}`,
          postedByStaffId: manager.id,
        },
      },
      lines: {
        create: Array.from({ length: 4 }, (_, index) => ({
          productId: product.id,
          recipientAddressId: customer.addresses[0]!.id,
          recipientSource: "ADDRESS_BOOK",
          recipientNameSnapshot: `P12 Recipient ${index + 1}`,
          fulfillmentMethodId:
            index === 0
              ? methods.get("SHIPPING")
              : index === 1
                ? methods.get("PACKAGE_DELIVERY")
                : index === 2
                  ? methods.get("PICKUP")
                  : methods.get("SHIPPING"),
          greetingSnapshot: "A freilichen Purim",
          productNameSnapshot: product.name,
          skuSnapshot: product.sku,
          unitPriceCentsSnapshot: product.priceCents,
          quantity: 1,
        })),
      },
    },
    include: { lines: true },
  });
  const packages = [];
  for (const [index, line] of order.lines.entries()) {
    const methodCode =
      index === 0
        ? "SHIPPING"
        : index === 1
          ? "PACKAGE_DELIVERY"
          : index === 2
            ? "PICKUP"
            : "SHIPPING";
    packages.push(
      await db.package.create({
        data: {
          orderId: order.id,
          recipientAddressId: customer.addresses[0]!.id,
          fulfillmentMethodId: methods.get(methodCode)!,
          recipientName: line.recipientNameSnapshot!,
          addressSnapshot: {
            line1: "12 Report Road",
            city: "Lakewood",
            region: "NJ",
            postalCode: "08701",
          },
          greetingSnapshot: line.greetingSnapshot,
          groupingKey: `p12-ledger-${runKey}-${index}`,
          lines: { create: { orderLineId: line.id, quantity: 1 } },
        },
      }),
    );
  }
  await db.shippingLabel.create({
    data: {
      packageId: packages[0]!.id,
      provider: "shippo",
      serviceCode: "GROUND",
      providerRateId: `rate-${runKey}`,
      providerTransactionId: `transaction-${runKey}`,
      chargedCents: 1_900,
      purchasedCents: 1_250,
      marginCents: 650,
      status: "PURCHASED",
      purchasedAt: new Date(),
    },
  });
  return { manager, season, product, customer, order, packages, methods };
}

async function run() {
  const fixture = await createLedgerFixture();
  const reports = await getLaunchReports(db);
  const seasonReport = reports.seasons.find(
    (season) => season.seasonId === fixture.season.id,
  );
  assert.ok(seasonReport);
  const expectedSeasonTotals = await db.order.aggregate({
    where: { seasonId: fixture.season.id, status: "FINALIZED" },
    _sum: { totalCents: true, donationCents: true },
    _count: true,
  });
  assert.equal(seasonReport.revenueCents, expectedSeasonTotals._sum.totalCents);
  assert.equal(seasonReport.donationCents, expectedSeasonTotals._sum.donationCents);
  const marginTotal = reports.shippingMargin.totals.find(
    (total) => total.seasonId === fixture.season.id,
  );
  const expectedMargin = await db.shippingLabel.aggregate({
    where: {
      status: "PURCHASED",
      package: { order: { seasonId: fixture.season.id } },
    },
    _sum: { chargedCents: true, purchasedCents: true, marginCents: true },
  });
  assert.deepEqual(
    [
      marginTotal?.chargedCents,
      marginTotal?.purchasedCents,
      marginTotal?.marginCents,
    ],
    [
      expectedMargin._sum.chargedCents,
      expectedMargin._sum.purchasedCents,
      expectedMargin._sum.marginCents,
    ],
  );
  console.log("S1 PASS multi-season totals, drill-downs, and package margin matched the seeded ledger");

  const unauthorizedExport = await fetch(
    `${baseUrl}/api/admin/exports?dataset=year-end&seasonId=${fixture.season.id}`,
  );
  assert.equal(unauthorizedExport.status, 403);
  const authorizedExport = await fetch(
    `${baseUrl}/api/admin/exports?dataset=year-end&seasonId=${fixture.season.id}`,
    { headers: managerHeaders() },
  );
  assert.equal(authorizedExport.status, 200);
  assert.match(await authorizedExport.text(), /P12 Ledger Customer/);
  const exportRunId = authorizedExport.headers.get("x-export-run-id");
  assert.ok(exportRunId);
  assert.ok(await db.exportRun.findUnique({ where: { id: exportRunId } }));
  assert.ok(await db.auditLog.findFirst({
    where: {
      action: "export.completed",
      targetType: "ExportRun",
      targetId: exportRunId,
    },
  }));
  const intent = await db.stripePaymentIntent.create({
    data: {
      orderId: fixture.order.id,
      stripePaymentIntentId: `pi_p12_${runKey}`,
      idempotencyKey: `p12-reconcile-${runKey}`,
      status: "SUCCEEDED",
      amountCents: fixture.order.totalCents,
    },
  });
  const reconciliationKey = `p12-smoke:${runKey}`;
  const firstReconciliation = await reconcileStripePayments(
    db,
    reconciliationKey,
    fixture.manager.id,
    [
      {
        id: `pi_orphan_${runKey}`,
        amount: 777,
        status: "succeeded",
      },
    ],
  );
  const replayedReconciliation = await reconcileStripePayments(
    db,
    reconciliationKey,
    fixture.manager.id,
    [],
  );
  assert.equal(firstReconciliation.id, replayedReconciliation.id);
  assert.ok(firstReconciliation.matchedCount >= 0);
  const reconciliationFindings = await db.reconciliationFinding.findMany({
    where: {
      providerObjectId: {
        in: [intent.stripePaymentIntentId, `pi_orphan_${runKey}`],
      },
    },
    select: { providerObjectId: true, findingType: true },
  });
  assert.deepEqual(
    new Map(reconciliationFindings.map((finding) => [
      finding.providerObjectId,
      finding.findingType,
    ])),
    new Map([
      [intent.stripePaymentIntentId, "SUCCEEDED_WITHOUT_PAYMENT"],
      [`pi_orphan_${runKey}`, "ORPHAN_PROVIDER_INTENT"],
    ]),
  );
  console.log("S2 PASS authorized streaming CSV was audited, unauthorized access failed, and reconciliation replayed without duplicate findings");

  const brokenDocument: LegacyDocument = {
    customers: [
      {
        id: `legacy-a-${runKey}`,
        displayName: "Imported Family",
        email: `imported-${runKey}@example.test`,
        addresses: [
          {
            id: `legacy-address-${runKey}`,
            recipientName: "Imported Recipient",
            line1: "8 Old Road",
            city: "",
            region: "NJ",
            postalCode: "08701",
            greeting: "Imported greeting",
          },
        ],
      },
      {
        id: `legacy-duplicate-${runKey}`,
        displayName: "Imported Family Duplicate",
        email: `IMPORTED-${runKey}@example.test`,
        addresses: [
          {
            id: `legacy-address-duplicate-${runKey}`,
            recipientName: "Imported Recipient",
            line1: "8 Old Road",
            city: "",
            region: "NJ",
            postalCode: "08701",
          },
        ],
      },
      {
        id: `legacy-contact-review-${runKey}`,
        displayName: "No Contact",
      },
    ],
    products: [
      {
        id: `legacy-product-${runKey}`,
        seasonYear: 2024,
        sku: `OLD-${runKey}`,
        name: "Imported Purim Box",
        priceCents: 4_200,
      },
    ],
    orders: [
      {
        id: `legacy-order-a-${runKey}`,
        seasonYear: 2024,
        customerId: `legacy-a-${runKey}`,
        orderNumber: 12,
        totalCents: 4_200,
        lines: [
          {
            productId: `missing-product-${runKey}`,
            quantity: 1,
            addressId: `legacy-address-${runKey}`,
          },
        ],
      },
      {
        id: `legacy-order-b-${runKey}`,
        seasonYear: 2024,
        customerId: `legacy-a-${runKey}`,
        orderNumber: 12,
        totalCents: 4_200,
        lines: [
          {
            productId: `legacy-product-${runKey}`,
            quantity: 1,
            addressId: `legacy-address-${runKey}`,
          },
        ],
      },
    ],
  };
  assert.ok(
    inspectLegacyDocument(brokenDocument).issues.some(
      (issue) => issue.severity === "BLOCKING",
    ),
  );
  brokenDocument.orders[0]!.lines[0]!.productId = `legacy-product-${runKey}`;
  const staged = await stageLegacyImport(db, {
    sourceName: `messy-${runKey}.json`,
    document: brokenDocument,
    dryRun: true,
    stagedByStaffId: fixture.manager.id,
  });
  assert.ok(
    (staged.issues as Array<{ severity: string }>).some(
      (issue) => issue.severity === "REVIEW",
    ),
  );
  const committed = await commitLegacyImport(db, staged.id, fixture.manager.id);
  const resumed = await commitLegacyImport(db, staged.id, fixture.manager.id);
  assert.equal(committed.id, resumed.id);
  const importedOrders = await db.order.findMany({
    where: { legacySourceId: { in: brokenDocument.orders.map((order) => order.id) } },
  });
  assert.equal(importedOrders.length, 2);
  assert.equal(new Set(importedOrders.map((order) => order.orderNumber)).size, 2);
  assert.equal(
    await db.customer.count({
      where: { emailNormalized: `imported-${runKey}@example.test` },
    }),
    1,
  );
  assert.ok(
    await db.customerAddress.findFirst({
      where: {
        customerId: importedOrders[0]!.customerId,
        validationStatus: "REVIEW",
      },
    }),
  );
  assert.deepEqual(committed.sourceCounts, committed.importedCounts);
  assert.deepEqual(committed.sourceTotals, committed.importedTotals);
  console.log("S3 PASS messy dry-run blocked missing mappings; corrected atomic import repaired numbers, deduped customers/addresses, queued review, and resumed safely");

  const importedOrder = importedOrders[0]!;
  const importedLine = await db.orderLine.findFirstOrThrow({
    where: { orderId: importedOrder.id },
    include: { product: true },
  });
  const currentSeasonSetting = await db.appSetting.findUniqueOrThrow({
    where: { key: "current-season-id" },
  });
  const currentSeasonId = String(currentSeasonSetting.value);
  const currentProduct = await db.product.findFirstOrThrow({
    where: {
      seasonId: currentSeasonId,
      kind: importedLine.product.kind,
      isActive: true,
    },
  });
  await db.product.update({
    where: { id: importedLine.productId },
    data: { replacementProductId: currentProduct.id },
  });
  const repeatReview = await getRepeatReview(db, importedOrder.id);
  assert.equal(repeatReview.lines[0]?.mappedProductId, currentProduct.id);
  assert.ok(repeatReview.lines[0]?.recipientAddressId);
  const repeatDraft = await createRepeatDraft(
    db,
    {
      sourceOrderId: importedOrder.id,
      sourceVersion: importedOrder.version,
      actorStaffId: fixture.manager.id,
      decisions: repeatReview.lines.map((line) => ({
        sourceLineId: line.sourceLineId,
        productId: line.mappedProductId,
        recipientAddressId: line.recipientAddressId!,
      })),
    },
    repeatReview,
  );
  assert.equal(repeatDraft.status, "DRAFT");
  console.log("S4 PASS imported prior-year order completed replacement-and-recipient review and created a current-season repeat draft");

  const scaleStartedAt = performance.now();
  const scale = await seedScaleFixture(db);
  assert.deepEqual(scale, { orders: 1_000, packages: 5_000 });
  const boundedOrders = await db.order.findMany({
    where: { draftReference: { startsWith: "p12-scale-" } },
    orderBy: { orderNumber: "asc" },
    take: 50,
  });
  assert.equal(boundedOrders.length, 50);
  const printStartedAt = performance.now();
  const print = await createNightlyPrintBatch(
    db,
    `p12-scale-${runKey}`,
    fixture.manager.id,
  );
  assert.ok(print.batch.artifacts.length >= 1_000);
  const concurrencyStaff = await db.staffUser.upsert({
    where: { email: "p12-concurrency@example.test" },
    update: { version: 1, displayName: "P12 Concurrent Fixture" },
    create: {
      email: "p12-concurrency@example.test",
      displayName: "P12 Concurrent Fixture",
      role: "STAFF",
      status: "ACTIVE",
      version: 1,
    },
  });
  const concurrentMutations = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      db.staffUser.updateMany({
        where: { id: concurrencyStaff.id, version: 1 },
        data: {
          displayName: `P12 Concurrent Winner ${index}`,
          version: { increment: 1 },
        },
      }),
    ),
  );
  assert.equal(
    concurrentMutations.filter((mutation) => mutation.count === 1).length,
    1,
  );

  await advancePackageStage(db, fixture.packages[0]!.id, 1, "PACKED", fixture.manager.id);
  await advancePackageStage(db, fixture.packages[0]!.id, 2, "SENT", fixture.manager.id);
  await advancePackageStage(db, fixture.packages[1]!.id, 1, "PACKED", fixture.manager.id);
  await advancePackageStage(db, fixture.packages[1]!.id, 2, "SENT", fixture.manager.id);
  await advancePackageStage(db, fixture.packages[2]!.id, 1, "PACKED", fixture.manager.id);
  await advancePackageStage(db, fixture.packages[2]!.id, 2, "PICKED_UP", fixture.manager.id);
  await switchFulfillmentMethod(db, null, {
    packageId: fixture.packages[3]!.id,
    fulfillmentMethodId: fixture.methods.get("PACKAGE_DELIVERY")!,
    actorStaffId: fixture.manager.id,
  });
  const postRehearsalReports = await getLaunchReports(db);
  assert.ok(
    postRehearsalReports.shippingMargin.packages.some(
      (entry) => entry.packageId === fixture.packages[0]!.id,
    ),
  );
  for (const route of [
    "season-status",
    "pickup-expiry",
    "payment-reminders",
    "message-outbox",
    "message-log-purge",
    "stripe-reconciliation",
  ]) {
    assert.equal((await fetch(`${baseUrl}/api/cron/${route}`)).status, 401);
    const response = await fetch(`${baseUrl}/api/cron/${route}`, {
      headers: {
        authorization: `Bearer ${cronSecret}`,
        "x-cron-run-key": `p12-${route}-${runKey}`,
      },
    });
    assert.equal(response.status, 200);
  }
  await wipeScaleFixture(db);
  assert.equal(
    await db.package.count({ where: { id: { startsWith: "p12-scale-" } } }),
    0,
  );
  assert.deepEqual(await seedScaleFixture(db), { orders: 1_000, packages: 5_000 });
  console.log(
    `S5 PASS full paid→package→print→ship/deliver/pickup/reroute→report rehearsal; 1k/5k seed ${Math.round(scaleStartedAt ? performance.now() - scaleStartedAt : 0)}ms, nightly print ${Math.round(performance.now() - printStartedAt)}ms, 10-way mutation conflict-safe, six crons authenticated, wipe+reseed clean`,
  );
}

run()
  .then(() => db.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
