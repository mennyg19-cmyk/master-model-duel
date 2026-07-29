// Domain checks for P7: package materialization on finalize (UR-001),
// split/regroup with conservation + absorption (G-003), the nightly print
// batch with idempotency and scoped reprints (UR-005), printing never moving
// stages (G-004), bulk advance reports (R-072), dashboard summaries (R-073),
// and PDF artifacts rendered from a real batch. Requires embedded Postgres
// on 4106 (db:start).

import { PrismaClient } from "@prisma/client";
import { finalizeOrder } from "../lib/orders/state-machine";
import { advancePackageStage, PackageConcurrencyError } from "../lib/packages/stages";
import { regroupPackage, splitPackage } from "../lib/packages/moves";
import { reprintBatch, runNightlyPrintBatch } from "../lib/packages/print-batches";
import { runBulkPackageAdvance } from "../lib/packages/bulk";
import { loadFulfillmentSummary } from "../lib/packages/fulfillment";
import { loadBatchForPrint, renderBatchPdf } from "../lib/print/pdf";
import { closeAllOpenSeasons, expectThrow, reopenSeasons } from "./test-db-helpers.mts";
import { pdfText } from "./lib/pdf-text.mts";
import { DomainRuleError } from "../lib/errors";

const prisma = new PrismaClient();
let failures = 0;

function check(label: string, condition: boolean) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`ok: ${label}`);
  }
}

const previouslyOpen = await closeAllOpenSeasons(prisma);
const stamp = Date.now();

const season = await prisma.season.create({ data: { name: `TEST-P7-${stamp}`, status: "OPEN" } });
const staff = await prisma.staffUser.create({
  data: {
    email: `p7-staff-${stamp}@example.org`,
    name: "P7 Staff",
    role: "MANAGER",
    status: "ACTIVE",
    confirmedAt: new Date(),
  },
});
const ctx = { staff: { id: staff.id, email: staff.email }, impersonator: null };
const customer = await prisma.customer.create({
  data: { email: `p7-${stamp}@example.org`, name: "P7 Customer" },
});
const product = await prisma.product.create({
  data: { slug: `p7-box-${stamp}`, name: "P7 Box", basePriceCents: 1000, seasonId: season.id },
});
// Materialization resolves the global methods by code; make them deterministic.
await prisma.fulfillmentMethod.upsert({
  where: { code: "PICKUP" },
  update: { active: true, stages: ["NEW", "PACKED", "PICKED_UP"], terminalStage: "PICKED_UP" },
  create: { code: "PICKUP", label: "Pickup", stages: ["NEW", "PACKED", "PICKED_UP"], terminalStage: "PICKED_UP" },
});
await prisma.fulfillmentMethod.upsert({
  where: { code: "DELIVERY" },
  update: { active: true, stages: ["NEW", "PRINTED", "PACKED", "SENT"], terminalStage: "SENT" },
  create: { code: "DELIVERY", label: "Delivery", stages: ["NEW", "PRINTED", "PACKED", "SENT"], terminalStage: "SENT" },
});

const address = await prisma.address.create({
  data: { customerId: customer.id, line1: "40 Faraway Ln", city: "Monsey", region: "NY", postalCode: "10952" },
});

// --- materialization on finalize (UR-001) -------------------------------------
// Order A: 3 recipient rows, 2 methods. The two Miriam rows share name +
// address + method + (null) greeting → ONE package; Bubby pickup is its own.
const orderA = await prisma.order.create({
  data: { seasonId: season.id, customerId: customer.id, status: "DRAFT", draftRef: `P7-A-${stamp}`, totalCents: 6000 },
});
const recBubby = await prisma.draftRecipient.create({
  data: {
    orderId: orderA.id,
    name: "Bubby Kohn",
    line1: "9 Hilltop Rd",
    city: "Lakewood",
    region: "NJ",
    postalCode: "08701",
    fulfillmentChoice: "PICKUP",
    greeting: "Happy Purim",
  },
});
const bulkAddress = { line1: "40 Faraway Ln", city: "Monsey", region: "NY", postalCode: "10952" };
const recMiriam1 = await prisma.draftRecipient.create({
  data: { orderId: orderA.id, name: "Aunt Miriam", ...bulkAddress, addressId: address.id, fulfillmentChoice: "BULK_DELIVERY", deliveryFeeCents: 900 },
});
const recMiriam2 = await prisma.draftRecipient.create({
  data: { orderId: orderA.id, name: "Aunt Miriam", ...bulkAddress, addressId: address.id, fulfillmentChoice: "BULK_DELIVERY", deliveryFeeCents: 900 },
});
const line1 = await prisma.orderLine.create({
  data: { orderId: orderA.id, recipientId: recBubby.id, productId: product.id, productName: "P7 Box", qty: 2, unitPriceCents: 1000, lineTotalCents: 2000 },
});
const line2 = await prisma.orderLine.create({
  data: { orderId: orderA.id, recipientId: recMiriam1.id, productId: product.id, productName: "P7 Box", qty: 1, unitPriceCents: 1000, lineTotalCents: 1000 },
});
const line3 = await prisma.orderLine.create({
  data: { orderId: orderA.id, recipientId: recMiriam2.id, productId: product.id, productName: "P7 Box", qty: 3, unitPriceCents: 1000, lineTotalCents: 3000 },
});

await finalizeOrder(orderA.id);

const packagesA = await prisma.package.findMany({
  where: { orderId: orderA.id },
  include: { lines: true, events: true },
});
check("finalize materializes exactly 2 packages (identical keys merge)", packagesA.length === 2);
const pickupPkg = packagesA.find((pkg) => pkg.channel === "PICKUP")!;
const deliveryPkg = packagesA.find((pkg) => pkg.channel === "BULK_DELIVERY")!;
check(
  "pickup package holds Bubby's line; delivery package merges both Miriam lines",
  pickupPkg.lines.length === 1 && pickupPkg.lines[0].orderLineId === line1.id && pickupPkg.lines[0].qty === 2
    && deliveryPkg.lines.length === 2 && deliveryPkg.lines.reduce((sum, line) => sum + line.qty, 0) === 4,
);
check(
  "channel + greeting + delivery fee snapshot ride the package",
  pickupPkg.greeting === "Happy Purim" && deliveryPkg.channel === "BULK_DELIVERY",
);
check(
  "every package opens at NEW with a materialize event",
  packagesA.every((pkg) => pkg.stage === "NEW" && pkg.version === 1)
    && packagesA.every((pkg) => pkg.events.some((event) => event.action === "materialize")),
);

// --- split (G-003) ------------------------------------------------------------
const splitPkg = await splitPackage({
  packageId: deliveryPkg.id,
  expectedVersion: 1,
  moves: [{ orderLineId: line3.id, qty: 2 }],
  actorId: staff.id,
});
const sourceAfterSplit = await prisma.package.findUnique({ where: { id: deliveryPkg.id }, include: { lines: true } });
const splitWithLines = await prisma.package.findUnique({ where: { id: splitPkg.id }, include: { lines: true } });
check(
  "split keeps the grouping identity and conserves units (1+1 source, 2 new)",
  splitPkg.groupingKey === deliveryPkg.groupingKey && splitPkg.orderId === orderA.id
    && sourceAfterSplit!.lines.reduce((sum, line) => sum + line.qty, 0) === 2
    && splitWithLines!.lines.length === 1 && splitWithLines!.lines[0].qty === 2,
);
check(
  "split wrote events on both packages",
  (await prisma.packageEvent.count({ where: { packageId: { in: [deliveryPkg.id, splitPkg.id] }, action: "split" } })) === 2,
);
check(
  "splitting every unit is refused — that is a regroup",
  await expectThrow(
    () => splitPackage({ packageId: splitPkg.id, expectedVersion: 1, moves: [{ orderLineId: line3.id, qty: 2 }], actorId: staff.id }),
    DomainRuleError,
  ),
);
check(
  "stale version on split is a concurrency refusal",
  await expectThrow(
    () => splitPackage({ packageId: deliveryPkg.id, expectedVersion: 1, moves: [{ orderLineId: line3.id, qty: 1 }], actorId: staff.id }),
    PackageConcurrencyError,
  ),
);

// --- regroup + absorption (G-003) ---------------------------------------------
// Source now holds L2(1) + L3(1); move the rest of L3, then all of L2 → absorbed.
const regroup1 = await regroupPackage({
  packageId: deliveryPkg.id,
  targetPackageId: splitPkg.id,
  expectedVersion: 2,
  moves: [{ orderLineId: line3.id, qty: 1 }],
  actorId: staff.id,
});
check("partial regroup keeps the source alive", regroup1.absorbed === false);
const regroup2 = await regroupPackage({
  packageId: deliveryPkg.id,
  targetPackageId: splitPkg.id,
  expectedVersion: 3,
  moves: [{ orderLineId: line2.id, qty: 1 }],
  actorId: staff.id,
});
check("emptying the source absorbs it", regroup2.absorbed === true);
check("absorbed package row is gone", (await prisma.package.findUnique({ where: { id: deliveryPkg.id } })) === null);
const merged = await prisma.package.findUnique({ where: { id: splitPkg.id }, include: { lines: true } });
check(
  "target holds every unit again (L2 1 + L3 3)",
  merged!.lines.reduce((sum, line) => sum + line.qty, 0) === 4 && merged!.lines.length === 2,
);
check(
  "regroup events retained on the surviving package",
  (await prisma.packageEvent.count({ where: { packageId: splitPkg.id, action: "regroup" } })) === 2,
);

// Cross-order regroup is refused: order B has its own pickup package.
const orderB = await prisma.order.create({
  data: { seasonId: season.id, customerId: customer.id, status: "DRAFT", draftRef: `P7-B-${stamp}`, totalCents: 1000 },
});
const recB = await prisma.draftRecipient.create({
  data: { orderId: orderB.id, name: "Cousin Zev", line1: "1 Shul Ln", city: "Lakewood", region: "NJ", postalCode: "08701", fulfillmentChoice: "PICKUP" },
});
const lineB = await prisma.orderLine.create({
  data: { orderId: orderB.id, recipientId: recB.id, productId: product.id, productName: "P7 Box", qty: 1, unitPriceCents: 1000, lineTotalCents: 1000 },
});
await finalizeOrder(orderB.id);
const pkgB = (await prisma.package.findFirst({ where: { orderId: orderB.id }, include: { lines: true } }))!;
check(
  "regroup across orders is refused",
  await expectThrow(
    () =>
      regroupPackage({
        packageId: pkgB.id,
        targetPackageId: splitPkg.id,
        expectedVersion: 1,
        moves: [{ orderLineId: lineB.id, qty: 1 }],
        actorId: staff.id,
      }),
    DomainRuleError,
  ),
);

// --- nightly batch: idempotency + print ≠ stage (UR-005/G-004) -------------------
const nightly1 = await runNightlyPrintBatch({ createdById: staff.id });
check(
  "nightly files one batch per filing group present (PICKUP + BULK_DELIVERY)",
  nightly1.batches.length === 2 && nightly1.packageCount === 3,
);
const pickupBatch = nightly1.batches.find((batch) => batch.filingGroup === "PICKUP")!;
const bulkBatch = nightly1.batches.find((batch) => batch.filingGroup === "BULK_DELIVERY")!;
check(
  "pickup batch claims both pickup packages; bulk batch claims the merged one",
  pickupBatch.packageCount === 2 && bulkBatch.packageCount === 1,
);
const stagesAfterPrint = await prisma.package.findMany({ where: { order: { seasonId: season.id } }, select: { stage: true } });
check("printing never advances any stage (all still NEW)", stagesAfterPrint.every((pkg) => pkg.stage === "NEW"));
check(
  "print events landed on every filed package",
  (await prisma.packageEvent.count({ where: { action: "print", package: { order: { seasonId: season.id } } } })) === 3,
);

const nightly2 = await runNightlyPrintBatch({ createdById: staff.id });
check("second nightly run is a no-op (idempotent by construction)", nightly2.batches.length === 0 && nightly2.packageCount === 0);
check(
  "both runs wrote CronRun rows",
  (await prisma.cronRun.count({ where: { name: "nightly-print", status: "OK" } })) >= 2,
);

// --- scoped reprints ---------------------------------------------------------------
const reprintGroup = await reprintBatch({ filingGroup: "PICKUP", createdById: staff.id });
check(
  "group reprint supersedes the nightly pickup batch and re-claims its packages",
  reprintGroup.supersedesId === pickupBatch.id && reprintGroup.packageCount === 2 && reprintGroup.trigger === "REPRINT_GROUP",
);
check(
  "unrelated groups are never regenerated",
  (await prisma.printBatch.count({ where: { seasonId: season.id, filingGroup: "BULK_DELIVERY" } })) === 1,
);
const reprintOrder = await reprintBatch({ orderId: orderB.id, createdById: staff.id });
check(
  "order reprint files exactly that order's packages under an ORDER: group",
  reprintOrder.filingGroup === `ORDER:${orderB.id}` && reprintOrder.packageCount === 1 && reprintOrder.trigger === "REPRINT_ORDER",
);
check(
  "first order reprint supersedes nothing — the nightly batch is a different scope",
  reprintOrder.supersedesId === null,
);
const reprintOrder2 = await reprintBatch({ orderId: orderB.id, createdById: staff.id });
check(
  "second order reprint supersedes the first order-scoped batch (same-scope chain)",
  reprintOrder2.supersedesId === reprintOrder.id,
);
check(
  "reprint demands exactly one scope",
  await expectThrow(() => reprintBatch({}), DomainRuleError)
    && await expectThrow(() => reprintBatch({ filingGroup: "PICKUP", orderId: orderB.id }), DomainRuleError),
);

// Terminal packages fall out of every future run/reprint. (P9 m2: the
// PICKED_UP stamp now requires the readiness sweep's pickupReadyAt — mark it
// the way the sweep would before stamping.)
await advancePackageStage({ packageId: pkgB.id, expectedVersion: 1, to: "PACKED", actorId: staff.id });
await prisma.package.update({ where: { id: pkgB.id }, data: { pickupReadyAt: new Date() } });
await advancePackageStage({ packageId: pkgB.id, expectedVersion: 2, to: "PICKED_UP", actorId: staff.id });
const nightly3 = await runNightlyPrintBatch({ createdById: staff.id });
check("terminal packages are never re-filed by the nightly run", nightly3.packageCount === 0 && nightly3.batches.length === 0);
const reprintAfterTerminal = await reprintBatch({ filingGroup: "PICKUP", createdById: staff.id });
check(
  "group reprint skips the terminal package, keeps the open one",
  reprintAfterTerminal.packageCount === 1 && reprintAfterTerminal.supersedesId === reprintGroup.id,
);

// --- bulk advance with per-package skip reasons (R-072) -----------------------------
const bulkReport = await runBulkPackageAdvance({ packageIds: [pickupPkg.id, splitPkg.id, "bogus-id"], to: "PRINTED", ctx });
check(
  "bulk PRINTED: delivery advances, pickup + bogus id skip with reasons",
  bulkReport.counts.succeeded === 1 && bulkReport.counts.skipped === 2
    && bulkReport.results.find((result) => result.packageId === pickupPkg.id)?.reason?.includes("Illegal package stage transition") === true
    && bulkReport.results.find((result) => result.packageId === "bogus-id")?.outcome === "skipped",
);
const bulkPack = await runBulkPackageAdvance({ packageIds: [pickupPkg.id, splitPkg.id], to: "PACKED", ctx });
check("bulk PACKED advances both (each inside its own stage list)", bulkPack.counts.succeeded === 2);

// --- dashboard summary (R-073) -------------------------------------------------------
const summary = await loadFulfillmentSummary(season.id);
const pickupSummary = summary.channels.find((channel) => channel.channel === "PICKUP")!;
const bulkSummaryChannel = summary.channels.find((channel) => channel.channel === "BULK_DELIVERY")!;
check(
  "channel summaries count packages per channel",
  pickupSummary.total === 2 && bulkSummaryChannel.total === 1,
);
check(
  "production buckets respect method stage lists (2 packed to send, nothing to print)",
  summary.production.toSend === 2 && summary.production.toPrint === 0,
);
check(
  "bulk consolidation savings: one destination, two recipients, one fee saved",
  summary.bulkSavings.destinations === 1 && summary.bulkSavings.recipients === 2
    && summary.bulkSavings.feesCollectedCents === 900 && summary.bulkSavings.savedCents === 900,
);

// --- PDF artifacts from a real persisted batch ------------------------------------------
const pickupPrint = await loadBatchForPrint(pickupBatch.id);
const slipsText = pdfText(await renderBatchPdf(pickupPrint, "slips"));
const labelsText = pdfText(await renderBatchPdf(pickupPrint, "labels"));
const cardsText = pdfText(await renderBatchPdf(pickupPrint, "cards"));
const wireA = (await prisma.order.findUnique({ where: { id: orderA.id } }))!.wireFormat!;
check(
  "slips PDF from the persisted batch carries both order refs",
  slipsText.startsWith("%PDF-") && slipsText.includes(wireA) && slipsText.includes("Cousin Zev"),
);
check("labels PDF carries recipients and the pickup sentinel", labelsText.includes("Bubby Kohn") && labelsText.includes("PICKUP"));
check("cards PDF prints only the greeted package", cardsText.includes("For Bubby Kohn") && !cardsText.includes("For Cousin Zev"));

// Cleanup: close our season before restoring whatever was open.
await prisma.season.update({ where: { id: season.id }, data: { status: "CLOSED" } });
await reopenSeasons(prisma, previouslyOpen);
await prisma.$disconnect();

if (failures > 0) {
  console.error(`${failures} P7 domain check(s) failed`);
  process.exit(1);
}
console.log("All P7 domain checks passed");
