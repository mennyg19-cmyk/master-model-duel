import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { autoOpenScheduledSeasons } from "../lib/seasons";
import { confirmRepeatDraft, createRepeatDraft, readRepeatDraft, resolveReplacementChain } from "../lib/repeat-orders";
import { LOCAL_DATABASE_URL, runWithLocalDatabase, startLocalDatabase, stopLocalDatabase } from "./local-db";

async function createPriorOrder(prisma: PrismaClient, input: { customerId: string; addressId: string; productId: string; seasonId: string; label: string }) {
  const method = await prisma.fulfillmentMethod.upsert({ where: { code: "DELIVERY" }, create: { code: "DELIVERY", name: "Local delivery" }, update: {} });
  const order = await prisma.order.create({
    data: {
      seasonId: input.seasonId,
      customerId: input.customerId,
      status: "FINALIZED",
      draftReference: `IMPORTED-${input.label}-${randomUUID()}`,
      wireFormat: { source: "historical-import" },
      lines: { create: { productId: input.productId, quantity: 2, productNameSnapshot: "Discontinued box", skuSnapshot: "LEGACY", unitPriceCents: 4100 } },
    },
    include: { lines: true },
  });
  await prisma.package.create({
    data: {
      orderId: order.id,
      addressId: input.addressId,
      fulfillmentMethodId: method.id,
      recipientName: "Repeat Recipient",
      greeting: "A warm Purim greeting",
      groupingKey: `repeat:${input.label}`,
      lines: { create: { orderLineId: order.lines[0]!.id, quantity: 2 } },
    },
  });
  return order;
}

async function verifySmoke() {
  const prisma = new PrismaClient({ datasources: { db: { url: LOCAL_DATABASE_URL } } });
  try {
    const priorSeason = await prisma.season.findUniqueOrThrow({ where: { year: 2025 } });
    const legacyProduct = await prisma.product.findUniqueOrThrow({ where: { seasonId_sku: { seasonId: priorSeason.id, sku: "PURIM-BOX-2025" } } });
    const bridgeSeason = await prisma.season.findUniqueOrThrow({ where: { year: 2026 } });
    const smokeYear = 3000 + Number.parseInt(randomUUID().slice(0, 6), 16);
    const bridgeProduct = await prisma.product.create({ data: { seasonId: bridgeSeason.id, sku: `P10-BRIDGE-${randomUUID().slice(0, 6)}`, name: "Bridge box", priceCents: 4300 } });
    const repeatSeason = await prisma.season.create({ data: { name: `P10 repeat ${smokeYear}`, year: smokeYear, status: "OPEN" } });
    const replacement = await prisma.product.create({ data: { seasonId: repeatSeason.id, sku: "P10-REPLACEMENT", name: "Mapped Celebration Box", priceCents: 4200 } });
    await prisma.productReplacement.createMany({ data: [
      { sourceProductId: legacyProduct.id, targetProductId: bridgeProduct.id },
      { sourceProductId: bridgeProduct.id, targetProductId: replacement.id },
    ] });
    const customer = await prisma.customer.create({
      data: {
        firstName: "P10",
        lastName: "Repeat",
        emailNormalized: `p10-${randomUUID()}@example.test`,
        addresses: { create: { recipientName: "Repeat Recipient", line1: "10 Repeat Street", city: "Brooklyn", state: "NY", postalCode: "11201", normalizedAddress: `p10-${randomUUID()}` } },
      },
      include: { addresses: true },
    });
    const priorOrder = await createPriorOrder(prisma, { customerId: customer.id, addressId: customer.addresses[0]!.id, productId: legacyProduct.id, seasonId: priorSeason.id, label: "one" });
    const candidates = await resolveReplacementChain(legacyProduct.id, repeatSeason.id);
    assert.deepEqual(candidates.map((candidate) => candidate.id), [replacement.id]);
    const draft = await createRepeatDraft(priorOrder.id, repeatSeason.id, customer.id);
    const review = await readRepeatDraft(draft.id, customer.id);
    assert.ok(review);
    assert.equal(review.repeat.lines[0]!.suggestedProductId, replacement.id);
    await confirmRepeatDraft(draft.id, [{ sourceLineId: review.repeat.lines[0]!.sourceLineId, productId: replacement.id, addressId: customer.addresses[0]!.id, greeting: "A warm Purim greeting" }], customer.id);
    const confirmed = await prisma.order.findUniqueOrThrow({ where: { id: draft.id }, include: { lines: true } });
    assert.equal(confirmed.lines[0]!.productId, replacement.id);
    assert.equal((confirmed.wireFormat as { lines: Array<{ greeting: string; recipient: { addressId: string } }> }).lines[0]!.greeting, "A warm Purim greeting");
    const secondRecipient = await prisma.address.create({
      data: {
        customerId: customer.id,
        recipientName: "Second Repeat Recipient",
        line1: "12 Repeat Street",
        city: "Brooklyn",
        state: "NY",
        postalCode: "11201",
        normalizedAddress: `p10-split-${randomUUID()}`,
      },
    });
    const originalPackage = await prisma.package.findFirstOrThrow({ where: { orderId: priorOrder.id }, include: { lines: true } });
    await prisma.packageLine.update({ where: { id: originalPackage.lines[0]!.id }, data: { quantity: 1 } });
    await prisma.package.create({
      data: {
        orderId: priorOrder.id,
        addressId: secondRecipient.id,
        fulfillmentMethodId: originalPackage.fulfillmentMethodId,
        recipientName: secondRecipient.recipientName,
        greeting: "A second Purim greeting",
        groupingKey: `repeat:split:${randomUUID()}`,
        lines: { create: { orderLineId: priorOrder.lines[0]!.id, quantity: 1 } },
      },
    });
    const splitDraft = await createRepeatDraft(priorOrder.id, repeatSeason.id, customer.id);
    const splitReview = await readRepeatDraft(splitDraft.id, customer.id);
    assert.deepEqual(
      splitReview?.repeat.lines.map((line) => line.recipient.addressId).sort(),
      [customer.addresses[0]!.id, secondRecipient.id].sort(),
    );
    console.log("S1 passed: discontinued imported lines followed a cross-season mapping, required replacement plus recipient confirmation, and preserved split-package recipients.");

    const secondCustomer = await prisma.customer.create({
      data: { firstName: "P10", lastName: "Bulk", emailNormalized: `p10-bulk-${randomUUID()}@example.test`, addresses: { create: { recipientName: "Bulk Recipient", line1: "11 Repeat Street", city: "Brooklyn", state: "NY", postalCode: "11201", normalizedAddress: `p10-bulk-${randomUUID()}` } } },
      include: { addresses: true },
    });
    const secondOrder = await createPriorOrder(prisma, { customerId: secondCustomer.id, addressId: secondCustomer.addresses[0]!.id, productId: legacyProduct.id, seasonId: priorSeason.id, label: "two" });
    const bulkDrafts = await Promise.all([priorOrder, secondOrder].map((order) => createRepeatDraft(order.id, repeatSeason.id)));
    assert.equal(bulkDrafts.length, 2);
    const scheduled = await prisma.season.create({ data: { name: `P10 scheduled ${smokeYear + 1}`, year: smokeYear + 1, status: "CLOSED", opensAt: new Date(Date.now() - 1_000) } });
    const expired = await prisma.season.create({ data: { name: `P10 expired ${smokeYear + 2}`, year: smokeYear + 2, status: "CLOSED", opensAt: new Date(Date.now() - 1_000), closesAt: new Date(Date.now() - 500) } });
    const manuallyClosed = await prisma.season.create({ data: { name: `P10 manually closed ${smokeYear + 3}`, year: smokeYear + 3, status: "CLOSED" } });
    assert.equal(await autoOpenScheduledSeasons(), 1);
    assert.equal((await prisma.season.findUniqueOrThrow({ where: { id: scheduled.id } })).status, "OPEN");
    assert.equal((await prisma.season.findUniqueOrThrow({ where: { id: expired.id } })).status, "CLOSED");
    assert.equal((await prisma.season.findUniqueOrThrow({ where: { id: manuallyClosed.id } })).status, "CLOSED");
    const cronLog = await prisma.cronRunLog.findFirstOrThrow({ where: { jobName: "season-auto-flip" }, orderBy: { startedAt: "desc" } });
    assert.deepEqual((cronLog.details as { openedSeasonIds: string[] }).openedSeasonIds, [scheduled.id]);
    assert.equal(await autoOpenScheduledSeasons(), 0);
    console.log("S2 passed: two customer repeat drafts were created, scheduled seasons auto-flipped, expired and manually-closed seasons stayed closed, and cron runs recorded affected season IDs.");

    assert.equal(confirmed.customerId, customer.id);
    assert.equal(confirmed.lines[0]!.quantity, 2);
    console.log("S3 passed: imported-history fixture preserved the mapped product, recipient address-book entry, and greeting in its repeat draft.");
  } finally {
    await prisma.$disconnect();
  }
}

async function runSmoke() {
  await startLocalDatabase();
  try {
    await runWithLocalDatabase("prisma", ["migrate", "deploy"]);
    await runWithLocalDatabase("tsx", ["prisma/seed.ts"]);
    await runWithLocalDatabase("tsx", ["scripts/smoke-p10.ts", "verify"]);
  } finally {
    await stopLocalDatabase();
  }
}

void (process.argv[2] === "verify" ? verifySmoke() : runSmoke()).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
