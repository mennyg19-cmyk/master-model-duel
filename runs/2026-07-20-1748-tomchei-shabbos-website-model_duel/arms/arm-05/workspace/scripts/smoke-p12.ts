import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { createRepeatDraft, readRepeatDraft } from "../lib/repeat-orders";
import { packageDashboard } from "../lib/package-operations";
import { commitLegacyImport, exportCsv, performanceReport, runStripeReconciliation, shippingMarginReport, stageLegacyImport } from "../lib/reporting";
import { LOCAL_DATABASE_URL, runWithLocalDatabase, startLocalDatabase, stopLocalDatabase } from "./local-db";

async function verifySmoke() {
  const prisma = new PrismaClient({ datasources: { db: { url: LOCAL_DATABASE_URL } } });
  try {
    const season = await prisma.season.findUniqueOrThrow({ where: { year: 2026 } });
    const product = await prisma.product.findUniqueOrThrow({ where: { seasonId_sku: { seasonId: season.id, sku: "PURIM-BOX-01" } } });
    const customer = await prisma.customer.findUniqueOrThrow({ where: { emailNormalized: "seed@example.test" } });
    const address = await prisma.address.findFirstOrThrow({ where: { customerId: customer.id } });
    const method = await prisma.fulfillmentMethod.findUniqueOrThrow({ where: { code: "DELIVERY" } });
    const packageType = await prisma.packageType.findFirstOrThrow();
    const staff = await prisma.staffUser.upsert({
      where: { clerkUserId: "p12-smoke" },
      create: { clerkUserId: "p12-smoke", email: "p12-smoke@example.test", displayName: "P12 Smoke", role: "MANAGER" },
      update: {},
    });
    const order = await prisma.order.create({
      data: {
        seasonId: season.id, customerId: customer.id, status: "FINALIZED", orderNumber: 1_000_000 + Math.floor(Date.now() / 1000) % 1_000_000, draftReference: `P12-${randomUUID()}`,
        totalCents: 5000, fulfillmentCents: 1200, paymentStatus: "POSTED", wireFormat: { source: "p12-smoke" },
        lines: { create: { productId: product.id, quantity: 1, productNameSnapshot: product.name, skuSnapshot: product.sku, unitPriceCents: product.priceCents } },
        packages: { create: { recipientName: "Seed Customer", greeting: "", groupingKey: "p12-smoke", fulfillmentMethodId: method.id, addressId: address.id } },
      },
      include: { packages: true },
    });
    await prisma.shipmentBox.create({ data: { packageId: order.packages[0].id, packageTypeId: packageType.id, carrier: "Fixture", chargedCents: 1200, labelCostCents: 800, marginCents: 400 } });
    const voidedShipment = await prisma.shipmentBox.create({ data: { packageId: order.packages[0].id, packageTypeId: packageType.id, carrier: "Voided fixture", chargedCents: 1200, labelCostCents: 800, marginCents: 400, labelVoidedAt: new Date() } });
    const draft = await prisma.order.create({
      data: {
        seasonId: season.id,
        customerId: customer.id,
        draftReference: `P12-DRAFT-${randomUUID()}`,
        wireFormat: { source: "p12-smoke" },
        lines: { create: { productId: product.id, quantity: 1, productNameSnapshot: "Draft-only item", skuSnapshot: "DRAFT-ONLY", unitPriceCents: product.priceCents } },
      },
    });
    const [performance, margins, marginCsv, itemSalesCsv] = await Promise.all([performanceReport(), shippingMarginReport(), exportCsv("shipping_margin"), exportCsv("item_sales")]);
    assert.ok(performance.some((entry) => entry.year === 2026 && entry.grossCents >= 5000));
    assert.ok(performance.some((entry) => entry.year === 2025));
    assert.ok(margins.packages.some((entry) => entry.packageId === order.packages[0].id && entry.marginCents === 400));
    assert.ok(!margins.packages.some((entry) => entry.shipmentId === voidedShipment.id));
    assert.match(marginCsv, /charged_cents/);
    assert.doesNotMatch(itemSalesCsv, /DRAFT-ONLY/);
    assert.ok(draft.id);
    console.log("S1 passed: multi-season totals and package shipping margins match the seeded ledger.");

    const intent = await prisma.stripePaymentIntent.create({ data: { orderId: order.id, stripeIntentId: `pi_p12_${randomUUID().replaceAll("-", "")}`, status: "succeeded", amountCents: 5000 } });
    await runStripeReconciliation(staff.id);
    await runStripeReconciliation(staff.id);
    assert.equal(await prisma.auditEvent.count({ where: { action: "stripe.reconciliation_flagged", subjectId: `stripe-orphan:${intent.id}` } }), 1);
    assert.match(await exportCsv("year_metrics"), /gross_cents/);
    console.log("S2 passed: export CSVs are generated and reconciliation flags an orphaned PaymentIntent only once.");

    const invalid = await stageLegacyImport("kind,year,email\norder,2025,broken@example.test", staff.id);
    assert.ok(invalid.errors.length > 0);
    const existingCustomer = await stageLegacyImport("kind,email,first_name,last_name\ncustomer,seed@example.test,Existing,Customer", staff.id);
    assert.ok(existingCustomer.errors.some((error) => error.includes("never overwrite customer data")));
    const legacyEmail = `legacy.p12-${randomUUID()}@example.test`;
    const legacyOrderNumber = 1_500_000 + Math.floor(Date.now() / 1000) % 1_000_000;
    const fixture = [
      "kind,year,email,first_name,last_name,sku,product_name,price_cents,total_cents,order_number,recipient_name,line1,city,state,postal_code",
      `customer,,${legacyEmail},Legacy,Customer,,,,,,,,,,`,
      "product,2025,,,,LEGACY-P12,Legacy Fixture,4200,,,,,,",
      `order,2025,${legacyEmail},,,LEGACY-P12,,,4200,${legacyOrderNumber},"Legacy, Recipient","12 Archive Lane",Brooklyn,NY,11201`,
    ].join("\n");
    const staged = await stageLegacyImport(fixture, staff.id);
    assert.equal(staged.errors.length, 0);
    await commitLegacyImport(staged.batchId, staff.id);
    const imported = await prisma.order.findFirstOrThrow({ where: { draftReference: { startsWith: `LEGACY-${staged.batchId.slice(0, 8)}` } }, include: { lines: true, payments: true, packages: { include: { address: true, lines: true } } } });
    assert.equal(imported.status, "FINALIZED");
    assert.equal(imported.payments.length, 1);
    assert.equal(imported.packages[0].address?.reviewStatus, "PENDING");
    assert.equal(imported.packages[0].lines.length, 1);
    assert.equal(await prisma.auditEvent.count({ where: { action: "legacy_import.committed", subjectId: staged.batchId } }), 1);
    console.log("S3 passed: malformed data stays dry-run-only; quoted CSV commits atomically with payment, audit, and address review evidence.");

    const sourceProduct = await prisma.product.findUniqueOrThrow({ where: { seasonId_sku: { seasonId: imported.seasonId, sku: "LEGACY-P12" } } });
    await prisma.productReplacement.upsert({ where: { sourceProductId_targetProductId: { sourceProductId: sourceProduct.id, targetProductId: product.id } }, create: { sourceProductId: sourceProduct.id, targetProductId: product.id }, update: {} });
    const repeat = await createRepeatDraft(imported.id, season.id);
    assert.ok(repeat.id);
    const repeatDetails = await readRepeatDraft(repeat.id);
    assert.equal(repeatDetails?.repeat.lines[0]?.recipient.recipientName, "Legacy, Recipient");
    console.log("S4 passed: a prior-year imported order enters the P10 repeat-order review flow.");

    const highestOrderNumber = await prisma.order.aggregate({ _max: { orderNumber: true } });
    const scaleNumberBase = Math.max(2_000_000, (highestOrderNumber._max.orderNumber ?? 0) + 1);
    const scalePrefix = `P12-SCALE-${randomUUID()}`;
    const scaleOrders = Array.from({ length: 1000 }, (_, index) => ({
      id: `p12-order-${randomUUID()}`, seasonId: season.id, customerId: customer.id, status: "FINALIZED" as const, orderNumber: scaleNumberBase + index,
      draftReference: `${scalePrefix}-${index}`, totalCents: 3600, paymentStatus: "POSTED" as const, wireFormat: { source: "scale" },
    }));
    await prisma.order.createMany({ data: scaleOrders });
    await prisma.package.createMany({ data: scaleOrders.flatMap((scaleOrder, orderIndex) => Array.from({ length: 5 }, (_, packageIndex) => ({
      orderId: scaleOrder.id, fulfillmentMethodId: method.id, recipientName: `Scale ${orderIndex}-${packageIndex}`, greeting: "", groupingKey: `${scalePrefix}:${orderIndex}:${packageIndex}`,
    }))) });
    assert.equal(await prisma.order.count({ where: { draftReference: { startsWith: scalePrefix } } }), 1000);
    assert.equal(await prisma.package.count({ where: { groupingKey: { startsWith: scalePrefix } } }), 5000);
    assert.ok((await packageDashboard(51)).total >= 5000);
    const vercel = await readFile(new URL("../vercel.json", import.meta.url), "utf8");
    assert.equal((JSON.parse(vercel).crons as unknown[]).length, 6);
    console.log("S5 scale check passed: 1k orders and 5k packages load; all six cron registrations remain present. Full E2E, nightly batch, and test-console route checks remain manual.");
  } finally {
    await prisma.$disconnect();
  }
}

async function runSmoke() {
  await startLocalDatabase();
  try {
    await runWithLocalDatabase("prisma", ["migrate", "deploy"]);
    await runWithLocalDatabase("tsx", ["prisma/seed.ts"]);
    await runWithLocalDatabase("tsx", ["scripts/smoke-p12.ts", "verify"]);
  } finally {
    await stopLocalDatabase();
  }
}

void (process.argv[2] === "verify" ? verifySmoke() : runSmoke()).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
