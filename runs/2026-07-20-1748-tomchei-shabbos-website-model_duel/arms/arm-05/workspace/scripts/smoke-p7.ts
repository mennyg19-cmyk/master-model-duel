import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { createNightlyPrintBatch, createPdf, orderPackingSlipDocument, printArtifactDocument, reprintArtifact, reprintOrderPackingSlip } from "../lib/print-batches";
import { advancePackageStatus, materializeOrderPackages, splitPackage } from "../lib/package-operations";
import { LOCAL_DATABASE_URL, runWithLocalDatabase } from "./local-db";

async function verifySmoke() {
  const prisma = new PrismaClient({ datasources: { db: { url: LOCAL_DATABASE_URL } } });
  try {
    const staff = await prisma.staffUser.upsert({
      where: { clerkUserId: "staff-p7-smoke" },
      create: { clerkUserId: "staff-p7-smoke", email: "staff-p7@example.test", displayName: "P7 Staff", role: "MANAGER" },
      update: { role: "MANAGER", revokedAt: null },
    });
    const [firstProduct, secondProduct] = await prisma.product.findMany({
      where: { sku: { in: ["PURIM-BOX-01", "PURIM-BOX-03"] } },
      orderBy: { sku: "asc" },
      take: 2,
    });
    assert.ok(firstProduct && secondProduct);
    const customer = await prisma.customer.create({
      data: {
        firstName: "Package",
        lastName: "Smoke",
        emailNormalized: `p7.${Date.now()}@example.test`,
        addresses: {
          create: [
            { recipientName: "Recipient One", line1: "1 Package Way", city: "Brooklyn", state: "NY", postalCode: "11201", normalizedAddress: `p7-one-${Date.now()}` },
            { recipientName: "Recipient Two", line1: "2 Package Way", city: "Brooklyn", state: "NY", postalCode: "11205", normalizedAddress: `p7-two-${Date.now()}` },
          ],
        },
      },
      include: { addresses: true },
    });
    const [firstAddress, secondAddress] = customer.addresses;
    assert.ok(firstAddress && secondAddress);
    const order = await prisma.order.create({
      data: {
        seasonId: firstProduct.seasonId,
        customerId: customer.id,
        status: "FINALIZED",
        draftReference: `P7-${Date.now()}`,
        wireFormat: {
          version: 2,
          lines: [
            { productId: firstProduct.id, quantity: 1, recipient: { addressId: firstAddress.id } },
            { productId: secondProduct.id, quantity: 1, recipient: { addressId: firstAddress.id } },
            { productId: firstProduct.id, quantity: 1, recipient: { addressId: secondAddress.id } },
            { productId: secondProduct.id, quantity: 1, recipient: { addressId: secondAddress.id } },
          ],
          checkout: {
            recipients: [
              { addressId: firstAddress.id, method: "LOCAL_DELIVERY", greeting: "For your Purim table" },
              { addressId: secondAddress.id, method: "SHIP", greeting: "With warm wishes" },
            ],
          },
        },
        lines: {
          create: [
            { productId: firstProduct.id, quantity: 1, productNameSnapshot: firstProduct.name, skuSnapshot: firstProduct.sku, unitPriceCents: firstProduct.priceCents },
            { productId: secondProduct.id, quantity: 1, productNameSnapshot: secondProduct.name, skuSnapshot: secondProduct.sku, unitPriceCents: secondProduct.priceCents },
            { productId: firstProduct.id, quantity: 1, productNameSnapshot: firstProduct.name, skuSnapshot: firstProduct.sku, unitPriceCents: firstProduct.priceCents },
            { productId: secondProduct.id, quantity: 1, productNameSnapshot: secondProduct.name, skuSnapshot: secondProduct.sku, unitPriceCents: secondProduct.priceCents },
          ],
        },
      },
    });

    const materialized = await materializeOrderPackages(order.id, staff.id);
    assert.equal(materialized.length, 2);
    const [firstPackage] = await prisma.package.findMany({ where: { orderId: order.id, isActive: true }, include: { lines: true }, orderBy: { createdAt: "asc" } });
    assert.ok(firstPackage && firstPackage.lines.length === 2);
    const split = await splitPackage(firstPackage.id, firstPackage.version, staff.id);
    assert.equal(await prisma.package.count({ where: { orderId: order.id, isActive: true } }), 3);
    assert.ok(await prisma.packageAudit.count({ where: { package: { orderId: order.id } } }) >= 4);
    console.log("S1 passed: finalized order grouped by recipient/method, split into printable packages, and retained package audit history.");

    const packageAwaitingShipment = await prisma.package.findUniqueOrThrow({ where: { id: firstPackage.id } });
    await advancePackageStatus(packageAwaitingShipment.id, packageAwaitingShipment.version, "PRINTED", staff.id);
    const smokeBatchOffsetDays = Number.parseInt(order.id.slice(-4), 36) % 3650 + 1;
    const batchDate = new Date(Date.now() + smokeBatchOffsetDays * 24 * 60 * 60 * 1000);
    const firstBatch = await createNightlyPrintBatch(staff.id, batchDate);
    assert.equal(firstBatch.created, true);
    const beforePrint = await prisma.package.findUniqueOrThrow({ where: { id: split.id } });
    const artifact = firstBatch.batch.artifacts.find((candidate) => candidate.kind === "GREETING_CARD");
    assert.ok(artifact);
    const artifactDocument = await printArtifactDocument(artifact.id);
    assert.ok(createPdf(artifactDocument).subarray(0, 8).toString() === "%PDF-1.4");
    assert.equal((await prisma.package.findUniqueOrThrow({ where: { id: split.id } })).status, beforePrint.status);
    await advancePackageStatus(split.id, beforePrint.version, "PRINTED", staff.id);
    const printed = await prisma.package.findUniqueOrThrow({ where: { id: split.id } });
    await advancePackageStatus(printed.id, printed.version, "PACKED", staff.id);
    const packed = await prisma.package.findUniqueOrThrow({ where: { id: split.id } });
    await advancePackageStatus(packed.id, packed.version, "SENT", staff.id);
    assert.equal((await prisma.package.findUniqueOrThrow({ where: { id: split.id } })).status, "SENT");
    console.log("S2 passed: PDFs left package state unchanged; Printed, Packed, and Sent were recorded as separate actions.");

    const secondBatch = await createNightlyPrintBatch(staff.id, batchDate);
    assert.equal(secondBatch.created, false);
    assert.equal(secondBatch.batch.artifacts.length, firstBatch.batch.artifacts.length);
    const reprintAuditsBefore = await prisma.auditEvent.count({
      where: { actorId: staff.id, action: { in: ["print.artifact_reprinted", "print.order_packing_slip_reprinted"] } },
    });
    await reprintArtifact(artifact.id, staff.id);
    await reprintOrderPackingSlip(order.id, staff.id);
    const reprintAuditsAfter = await prisma.auditEvent.count({
      where: { actorId: staff.id, action: { in: ["print.artifact_reprinted", "print.order_packing_slip_reprinted"] } },
    });
    assert.equal(reprintAuditsAfter, reprintAuditsBefore + 2);
    assert.ok((await orderPackingSlipDocument(order.id)).lines.length > 0);
    const unrelatedCount = await prisma.printArtifact.count({ where: { batchId: firstBatch.batch.id } });
    assert.equal(unrelatedCount, firstBatch.batch.artifacts.length);
    assert.equal((await prisma.package.findUniqueOrThrow({ where: { id: packageAwaitingShipment.id } })).status, "PRINTED");
    console.log("S3 passed: the nightly batch was idempotent, reprints wrote scoped audits, and a printed package remained unshipped.");
  } finally {
    await prisma.$disconnect();
  }
}

async function runSmoke() {
  await runWithLocalDatabase("prisma", ["migrate", "deploy"]);
  await runWithLocalDatabase("tsx", ["prisma/seed.ts"]);
  await runWithLocalDatabase("tsx", ["scripts/smoke-p7.ts", "verify"]);
}

void (process.argv[2] === "verify" ? verifySmoke() : runSmoke()).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
