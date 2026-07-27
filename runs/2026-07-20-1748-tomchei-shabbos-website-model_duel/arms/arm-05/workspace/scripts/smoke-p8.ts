import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createDevSessionToken } from "../lib/dev-auth";
import { materializeOrderPackages, advancePackageStatus } from "../lib/package-operations";
import { createPackageLabel, refreshPackageTracking, validatePackageAddress, voidPackageLabel } from "../lib/shipping";
import { selectMarginRate, type ShippoRate } from "../lib/shippo";
import { createDraft, readDraft, saveDraft, serializeDraft } from "../lib/order-builder";
import { startCheckout } from "../lib/checkout";
import { LOCAL_DATABASE_URL, runWithLocalDatabase } from "./local-db";

function fixtureRate(carrier: ShippoRate["carrier"], amountCents: number): ShippoRate {
  return {
    id: `rate_${carrier.toLowerCase()}_${amountCents}`,
    carrier,
    service: carrier === "USPS" ? "USPS Ground Advantage" : `${carrier} Ground`,
    amountCents,
    expiresAt: new Date(Date.now() + 60_000),
  };
}

function customerRequest() {
  const token = createDevSessionToken({ userId: "customer-seed", email: "seed@example.test", expiresAt: Date.now() + 60_000 });
  return new Request("http://localhost:3105/api/order/drafts", { headers: { "x-dev-session": token } });
}

async function verifySmoke() {
  const smokeRunId = randomUUID();
  delete process.env.SHIPPO_API_TOKEN;
  delete process.env.SHIPPO_FEDEX_CARRIER_ACCOUNT_ID;
  delete process.env.SHIPPO_UPS_CARRIER_ACCOUNT_ID;
  Object.assign(process.env, {
    NODE_ENV: "development",
    DEV_AUTH_MODE: "true",
    DEV_AUTH_SECRET: "p8-smoke-secret",
  });
  const prisma = new PrismaClient({ datasources: { db: { url: LOCAL_DATABASE_URL } } });
  try {
    const staff = await prisma.staffUser.upsert({
      where: { clerkUserId: "staff-p8-smoke" },
      create: { clerkUserId: "staff-p8-smoke", email: "staff-p8@example.test", displayName: "P8 Staff", role: "MANAGER" },
      update: { role: "MANAGER", revokedAt: null },
    });
    const firstSelection = selectMarginRate([fixtureRate("FEDEX", 2210), fixtureRate("UPS", 1525), fixtureRate("USPS", 1840)]);
    const reversedSelection = selectMarginRate([fixtureRate("FEDEX", 1430), fixtureRate("UPS", 2195), fixtureRate("USPS", 1710)]);
    assert.equal(firstSelection.charge.amountCents, 2210);
    assert.equal(firstSelection.purchase.amountCents, 1525);
    assert.equal(firstSelection.spreadCents, 685);
    assert.equal(reversedSelection.charge.carrier, "UPS");
    assert.equal(reversedSelection.purchase.carrier, "FEDEX");

    const product = await prisma.product.findFirstOrThrow({ where: { sku: "PURIM-BOX-01" } });
    const customer = await prisma.customer.create({
      data: {
        firstName: "Shipping",
        lastName: "Smoke",
        emailNormalized: `p8.${smokeRunId}@example.test`,
        addresses: {
          create: { recipientName: "Ship Recipient", line1: "8 Shipping Way", city: "Brooklyn", state: "NY", postalCode: "11201", normalizedAddress: `p8-${smokeRunId}` },
        },
      },
      include: { addresses: true },
    });
    const address = customer.addresses[0];
    assert.ok(address);
    const order = await prisma.order.create({
      data: {
        seasonId: product.seasonId,
        customerId: customer.id,
        status: "FINALIZED",
        draftReference: `P8-${smokeRunId}`,
        wireFormat: {
          version: 2,
          lines: [{ productId: product.id, quantity: 1, recipient: { addressId: address.id } }],
          checkout: {
            recipients: [{ addressId: address.id, method: "SHIP", greeting: "Happy Purim!" }],
            shippingQuotes: [{ addressId: address.id, customerChargeCents: 2200, marginCents: 705, providerMode: "fixture" }],
          },
        },
        fulfillmentCents: 2200,
        lines: { create: { productId: product.id, quantity: 1, productNameSnapshot: product.name, skuSnapshot: product.sku, unitPriceCents: product.priceCents } },
      },
    });
    const [packageRecord] = await materializeOrderPackages(order.id, staff.id);
    assert.ok(packageRecord);
    const validation = await validatePackageAddress(packageRecord.id);
    assert.equal(validation.isValid, true);
    const firstLabel = await createPackageLabel(packageRecord.id, staff.id);
    assert.equal(firstLabel.carrier, "UPS");
    assert.equal(firstLabel.chargedCents, 2200);
    assert.equal(firstLabel.labelCostCents, 1495);
    assert.equal(firstLabel.marginCents, 705);
    console.log("S1 passed: the label bought the cheapest ground rate and reconciled its charge and margin to the checkout-time customer payment.");

    await voidPackageLabel(packageRecord.id, staff.id);
    const reboughtLabel = await createPackageLabel(packageRecord.id, staff.id);
    assert.notEqual(reboughtLabel.id, firstLabel.id);
    const draftRequest = customerRequest();
    const { draft } = await createDraft(draftRequest);
    await saveDraft(draftRequest, draft.id, {
      lines: [{
        productId: product.id,
        quantity: 1,
        addOns: [],
        recipient: { kind: "new", recipientName: "Checkout Ship", line1: "9 Checkout Way", city: "Brooklyn", state: "NY", postalCode: "11201" },
      }],
    });
    const shippingDraft = await readDraft(draftRequest, draft.id);
    assert.ok(shippingDraft);
    const shippingAddressId = ((shippingDraft.wireFormat as { lines?: Array<{ recipient?: { addressId?: string } }> }).lines ?? [])[0]?.recipient?.addressId;
    const shippingAddress = shippingDraft.customer!.addresses.find((address) => address.id === shippingAddressId);
    assert.ok(shippingAddress);
    await startCheckout(shippingDraft.id, {
      donationCents: 0,
      recipients: [{ addressId: shippingAddress.id, method: "SHIP", greeting: "Ship it!" }],
    }, "http://localhost:3105/api/checkout");
    const quotedOrder = await prisma.order.findUniqueOrThrow({ where: { id: shippingDraft.id } });
    assert.equal(quotedOrder.fulfillmentCents, 2050);
    const sanitizedDraft = serializeDraft(await readDraft(draftRequest, shippingDraft.id));
    const checkout = (sanitizedDraft?.wireFormat as { checkout?: { shippingQuotes?: unknown } }).checkout;
    assert.equal(checkout?.shippingQuotes, undefined);
    console.log("S2 passed: void-and-rebuy produced a new label, checkout replaced the P5 placeholder, and draft output omitted internal margin data.");

    const refreshedTracking = await refreshPackageTracking(packageRecord.id, staff.id);
    assert.equal(refreshedTracking.trackingStatus, "IN_TRANSIT");
    const printedPackage = await prisma.package.findUniqueOrThrow({ where: { id: packageRecord.id } });
    await advancePackageStatus(printedPackage.id, printedPackage.version, "PRINTED", staff.id);
    await voidPackageLabel(packageRecord.id, staff.id);
    const voidedLabel = await prisma.shipmentBox.findUniqueOrThrow({ where: { id: reboughtLabel.id } });
    assert.ok(voidedLabel.labelVoidedAt);
    assert.equal((await prisma.package.findUniqueOrThrow({ where: { id: packageRecord.id } })).status, "PRINTED");
    console.log("S3 passed: a printed, unshipped label refreshed tracking and remained voidable for the P9 reroute boundary.");
  } finally {
    await prisma.$disconnect();
  }
}

async function runSmoke() {
  await runWithLocalDatabase("prisma", ["migrate", "deploy"]);
  await runWithLocalDatabase("tsx", ["prisma/seed.ts"]);
  await runWithLocalDatabase("tsx", ["scripts/smoke-p8.ts", "verify"]);
}

void (process.argv[2] === "verify" ? verifySmoke() : runSmoke()).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
