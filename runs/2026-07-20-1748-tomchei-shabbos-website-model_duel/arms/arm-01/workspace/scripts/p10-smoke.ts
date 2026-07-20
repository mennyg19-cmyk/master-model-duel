import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  createRepeatDraft,
  getRepeatReview,
  repeatOrdersInBulk,
  reviewOrdersInBulk,
  resolveReplacementChain,
} from "../src/domain/repeat-orders";
import {
  applyScheduledSeasonStatuses,
  createSeasonFromTemplate,
  scheduleSeasonStatus,
} from "../src/domain/seasons";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const separator = line.indexOf("=");
  if (separator > 0 && !line.startsWith("#")) {
    process.env[line.slice(0, separator)] ??= line.slice(separator + 1);
  }
}

const prisma = new PrismaClient();
const runKey = randomUUID().slice(0, 8);
const authSecret = process.env.TEST_AUTH_SECRET ?? "p5-local-smoke-signing-key-2026";
const customerClerkId = `p10_customer_${runKey}`;

function authHeaders() {
  const timestamp = Date.now();
  const signature = createHmac("sha256", authSecret)
    .update(`${customerClerkId}.${timestamp}`)
    .digest("hex");
  return {
    "x-test-clerk-user-id": customerClerkId,
    "x-test-auth-token": `${timestamp}.${signature}`,
  };
}

async function createSourceOrder(input: {
  seasonId: string;
  customerId: string;
  productId: string;
  productName: string;
  sku: string;
  priceCents: number;
  addressId: string;
  recipientName: string;
  fulfillmentMethodId: string;
  reference: string;
  greeting: string;
}) {
  return prisma.order.create({
    data: {
      seasonId: input.seasonId,
      customerId: input.customerId,
      status: "FINALIZED",
      orderNumber: Math.floor(Math.random() * 1_000_000),
      draftReference: input.reference,
      subtotalCents: input.priceCents,
      totalCents: input.priceCents,
      defaultGreeting: input.greeting,
      finalizedAt: new Date(),
      lines: {
        create: {
          productId: input.productId,
          recipientAddressId: input.addressId,
          recipientSource: "ADDRESS_BOOK",
          recipientNameSnapshot: input.recipientName,
          fulfillmentMethodId: input.fulfillmentMethodId,
          greetingSnapshot: input.greeting,
          productNameSnapshot: input.productName,
          skuSnapshot: input.sku,
          unitPriceCentsSnapshot: input.priceCents,
          quantity: 1,
        },
      },
    },
    include: { lines: true },
  });
}

async function run() {
  const maxYear = await prisma.season.aggregate({ _max: { year: true } });
  const priorYear = (maxYear._max.year ?? 2027) + 10;
  const priorSeason = await prisma.season.create({
    data: {
      name: `P10 Prior ${runKey}`,
      year: priorYear,
      status: "CLOSED",
      fulfillmentMethods: {
        create: { code: "SHIPPING", displayName: "Shipping", isShipping: true },
      },
    },
    include: { fulfillmentMethods: true },
  });
  const bridgeSeason = await prisma.season.create({
    data: { name: `P10 Bridge ${runKey}`, year: priorYear + 1, status: "CLOSED" },
  });
  const targetSeason = await prisma.season.create({
    data: {
      name: `P10 Target ${runKey}`,
      year: priorYear + 2,
      status: "OPEN",
      fulfillmentMethods: {
        create: { code: "SHIPPING", displayName: "Shipping", isShipping: true },
      },
    },
    include: { fulfillmentMethods: true },
  });
  await prisma.appSetting.upsert({
    where: { key: "current-season-id" },
    update: { value: targetSeason.id },
    create: { key: "current-season-id", value: targetSeason.id },
  });
  await prisma.season.updateMany({
    where: { id: { not: targetSeason.id }, status: "OPEN" },
    data: { status: "CLOSED" },
  });

  const mappedSource = await prisma.product.create({
    data: {
      seasonId: priorSeason.id,
      sku: `OLD-${runKey}`,
      name: "Discontinued classic",
      kind: "PACKAGE",
      priceCents: 5000,
      isActive: false,
    },
  });
  const unmappedSource = await prisma.product.create({
    data: {
      seasonId: priorSeason.id,
      sku: `UNMAPPED-${runKey}`,
      name: "Unmapped imported gift",
      kind: "PACKAGE",
      priceCents: 5100,
      isActive: false,
    },
  });
  const bridgeProduct = await prisma.product.create({
    data: {
      seasonId: bridgeSeason.id,
      sku: `BRIDGE-${runKey}`,
      name: "Bridge classic",
      kind: "PACKAGE",
      priceCents: 5150,
    },
  });
  const targetProduct = await prisma.product.create({
    data: {
      seasonId: targetSeason.id,
      sku: `CURRENT-${runKey}`,
      name: "Current classic",
      kind: "PACKAGE",
      priceCents: 5200,
    },
  });
  await prisma.product.create({
    data: {
      seasonId: targetSeason.id,
      sku: `PREMIUM-${runKey}`,
      name: "Current premium",
      kind: "PACKAGE",
      priceCents: 9000,
    },
  });
  await prisma.product.update({
    where: { id: mappedSource.id },
    data: { replacementProductId: bridgeProduct.id },
  });
  await prisma.product.update({
    where: { id: bridgeProduct.id },
    data: { replacementProductId: targetProduct.id },
  });
  assert.equal(
    await resolveReplacementChain(prisma, mappedSource.id, targetSeason.id),
    targetProduct.id,
  );

  const customer = await prisma.customer.create({
    data: {
      displayName: "P10 Repeat Customer",
      email: `p10-${runKey}@example.test`,
      emailNormalized: `p10-${runKey}@example.test`,
      accounts: {
        create: {
          clerkUserId: customerClerkId,
          email: `p10-${runKey}@example.test`,
        },
      },
      addresses: {
        create: {
          label: "Imported friend",
          recipientName: "Imported Recipient",
          line1: "10 Repeat Lane",
          city: "Lakewood",
          region: "NJ",
          postalCode: "08701",
          normalizedKey: `10-repeat-${runKey}`,
          rememberedGreeting: "Freilichen Purim from last year",
        },
      },
    },
    include: { addresses: true },
  });
  const address = customer.addresses[0]!;
  const priorMethod = priorSeason.fulfillmentMethods[0]!;
  const targetMethod = targetSeason.fulfillmentMethods[0]!;
  const mappedOrder = await createSourceOrder({
    seasonId: priorSeason.id,
    customerId: customer.id,
    productId: mappedSource.id,
    productName: mappedSource.name,
    sku: mappedSource.sku,
    priceCents: mappedSource.priceCents,
    addressId: address.id,
    recipientName: address.recipientName,
    fulfillmentMethodId: priorMethod.id,
    reference: `P10-MAPPED-${runKey}`,
    greeting: "Freilichen Purim from last year",
  });
  await prisma.orderLine.create({
    data: {
      orderId: mappedOrder.id,
      productId: unmappedSource.id,
      recipientAddressId: address.id,
      recipientSource: "ADDRESS_BOOK",
      recipientNameSnapshot: address.recipientName,
      fulfillmentMethodId: priorMethod.id,
      greetingSnapshot: "Please choose or remove",
      productNameSnapshot: unmappedSource.name,
      skuSnapshot: unmappedSource.sku,
      unitPriceCentsSnapshot: unmappedSource.priceCents,
      quantity: 1,
    },
  });
  const review = await getRepeatReview(prisma, mappedOrder.id);
  assert.equal(review.lines[0]!.mappedProductId, targetProduct.id);
  assert.equal(review.lines[0]!.suggestions[0]!.id, targetProduct.id);
  assert.equal(review.lines[1]!.mappedProductId, null);
  const reviewResponse = await fetch(
    `http://127.0.0.1:3101/account/orders/${mappedOrder.id}/repeat`,
    { headers: authHeaders() },
  );
  assert.equal(reviewResponse.status, 200);
  const reviewHtml = await reviewResponse.text();
  assert.match(reviewHtml, /Replacement required/);
  assert.match(reviewHtml, /confirm every replacement and recipient/i);
  const reviewedDraft = await createRepeatDraft(prisma, {
    sourceOrderId: mappedOrder.id,
    sourceVersion: mappedOrder.version,
    decisions: review.lines.map((line) => ({
      sourceLineId: line.sourceLineId,
      productId: line.mappedProductId,
      recipientAddressId: address.id,
    })),
  });
  assert.equal(await prisma.orderLine.count({ where: { orderId: reviewedDraft.id } }), 1);
  console.log("S1 PASS chained discontinued mapping, closest-price default, forced unmapped choice, replacement/recipient review page");

  const secondCustomer = await prisma.customer.create({
    data: {
      displayName: "P10 Bulk Customer",
      email: `p10-bulk-${runKey}@example.test`,
      emailNormalized: `p10-bulk-${runKey}@example.test`,
      addresses: {
        create: {
          recipientName: "Bulk Recipient",
          line1: "20 Repeat Lane",
          city: "Lakewood",
          region: "NJ",
          postalCode: "08701",
          normalizedKey: `20-repeat-${runKey}`,
        },
      },
    },
    include: { addresses: true },
  });
  const bulkOrder = await createSourceOrder({
    seasonId: priorSeason.id,
    customerId: secondCustomer.id,
    productId: mappedSource.id,
    productName: mappedSource.name,
    sku: mappedSource.sku,
    priceCents: mappedSource.priceCents,
    addressId: secondCustomer.addresses[0]!.id,
    recipientName: secondCustomer.addresses[0]!.recipientName,
    fulfillmentMethodId: priorMethod.id,
    reference: `P10-BULK-${runKey}`,
    greeting: "Bulk greeting",
  });
  const importedOrder = await createSourceOrder({
    seasonId: priorSeason.id,
    customerId: customer.id,
    productId: mappedSource.id,
    productName: mappedSource.name,
    sku: mappedSource.sku,
    priceCents: mappedSource.priceCents,
    addressId: address.id,
    recipientName: address.recipientName,
    fulfillmentMethodId: priorMethod.id,
    reference: `IMPORT-P10-${runKey}`,
    greeting: "Imported greeting survives",
  });
  const staff = await prisma.staffUser.create({
    data: {
      email: `p10-manager-${runKey}@example.test`,
      displayName: "P10 Manager",
      role: "MANAGER",
      status: "ACTIVE",
      confirmedAt: new Date(),
    },
  });
  const bulkReview = await reviewOrdersInBulk(prisma, [
    { orderId: bulkOrder.id, version: bulkOrder.version },
    { orderId: importedOrder.id, version: importedOrder.version },
  ]);
  assert.equal(bulkReview.ready.length, 2);
  assert.equal(bulkReview.conflicts.length, 0);
  const bulk = await repeatOrdersInBulk(prisma, staff.id, bulkReview.ready);
  assert.equal(bulk.applied.length, 2);
  assert.equal(bulk.conflicts.length, 0);
  await prisma.season.update({
    where: { id: targetSeason.id },
    data: { status: "CLOSED" },
  });
  await scheduleSeasonStatus(prisma, {
    seasonId: targetSeason.id,
    status: "OPEN",
    scheduledAt: new Date(Date.now() - 1000),
    actorStaffId: staff.id,
  });
  assert.equal(await applyScheduledSeasonStatuses(prisma), 1);
  assert.equal(
    (await prisma.season.findUniqueOrThrow({ where: { id: targetSeason.id } })).status,
    "OPEN",
  );
  const wizardSeason = await createSeasonFromTemplate(prisma, {
    name: `P10 Wizard ${runKey}`,
    year: priorYear + 3,
    sourceSeasonId: targetSeason.id,
    actorStaffId: staff.id,
  });
  const clonedTargetProduct = await prisma.product.findUniqueOrThrow({
    where: {
      seasonId_sku: { seasonId: wizardSeason.id, sku: targetProduct.sku },
    },
  });
  const clonedTargetMethod = await prisma.fulfillmentMethod.findUniqueOrThrow({
    where: {
      seasonId_code: { seasonId: wizardSeason.id, code: targetMethod.code },
    },
  });
  assert.equal(wizardSeason.status, "CLOSED");
  assert.equal(
    (
      await prisma.appSetting.findUniqueOrThrow({
        where: { key: "current-season-id" },
      })
    ).value,
    wizardSeason.id,
  );
  assert.equal(
    (await prisma.product.findUniqueOrThrow({ where: { id: targetProduct.id } }))
      .replacementProductId,
    clonedTargetProduct.id,
  );
  console.log("S2 PASS bounded bulk repeat created 2 drafts; auto-flip opened on time; wizard cloned a closed current season with forward mappings");

  const importedReview = await getRepeatReview(prisma, importedOrder.id);
  const importedDraft = await createRepeatDraft(prisma, {
    sourceOrderId: importedOrder.id,
    sourceVersion: importedOrder.version,
    decisions: importedReview.lines.map((line) => ({
      sourceLineId: line.sourceLineId,
      productId: line.mappedProductId,
      recipientAddressId: line.recipientAddressId!,
    })),
  });
  const repeatedImported = await prisma.order.findUniqueOrThrow({
    where: { id: importedDraft.id },
    include: {
      lines: { include: { recipientAddress: true, fulfillmentMethod: true } },
    },
  });
  assert.equal(repeatedImported.lines[0]!.productId, clonedTargetProduct.id);
  assert.equal(repeatedImported.lines[0]!.recipientAddressId, address.id);
  assert.equal(repeatedImported.lines[0]!.recipientAddress?.customerId, customer.id);
  assert.equal(repeatedImported.lines[0]!.greetingSnapshot, "Imported greeting survives");
  assert.equal(repeatedImported.lines[0]!.fulfillmentMethodId, clonedTargetMethod.id);
  console.log("S3 PASS imported-order stub preserved mapped product, address-book recipient, greeting, and target fulfillment");
}

run()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
