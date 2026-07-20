import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { calculateFulfillmentFees } from "../src/domain/checkout";
import {
  buyPackageLabel,
  quoteDraftShipping,
  quotePackage,
  refreshPackageTracking,
  validatePackageAddress,
  voidPackageLabel,
} from "../src/domain/shipping";
import type {
  AddressValidation,
  CarrierRate,
  PurchasedLabel,
  ShippingAddress,
  ShippingParcel,
  ShippingProvider,
} from "../src/lib/shippo";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const separator = line.indexOf("=");
  if (separator > 0 && !line.startsWith("#")) {
    process.env[line.slice(0, separator)] ??= line.slice(separator + 1);
  }
}
process.env.SHIP_FROM_NAME = "Tomchei Shabbos";
process.env.SHIP_FROM_STREET1 = "1 Warehouse Way";
process.env.SHIP_FROM_CITY = "Brooklyn";
process.env.SHIP_FROM_STATE = "NY";
process.env.SHIP_FROM_ZIP = "11219";

const prisma = new PrismaClient();
const runKey = randomUUID().slice(0, 8);
const authSecret = "p5-local-smoke-signing-key-2026";
const managerClerkId = `p8_manager_${runKey}`;
let purchaseCount = 0;

const fixtureRates: CarrierRate[] = [
  {
    id: "fedex-high",
    carrier: "fedex",
    serviceCode: "ground",
    serviceName: "FedEx Ground",
    amountCents: 2499,
    currency: "usd",
    expiresAt: new Date(Date.now() + 20 * 60_000),
  },
  {
    id: "ups-low",
    carrier: "ups",
    serviceCode: "ground",
    serviceName: "UPS Ground",
    amountCents: 1815,
    currency: "usd",
    expiresAt: new Date(Date.now() + 20 * 60_000),
  },
];

const provider: ShippingProvider = {
  async getRates(input: {
    from: ShippingAddress;
    to: ShippingAddress;
    parcels: ShippingParcel[];
  }) {
    assert.equal(input.to.zip, "11219");
    assert.equal(input.parcels.length, 2, "Two gifts must plan into two weight-limited boxes.");
    return fixtureRates;
  },
  async buyLabel(): Promise<PurchasedLabel> {
    purchaseCount += 1;
    return {
      transactionId: `tx-${runKey}-${purchaseCount}`,
      trackingNumber: `TRACK${purchaseCount}`,
      trackingStatus: "PRE_TRANSIT",
      labelUrl: `https://example.test/labels/${purchaseCount}.pdf`,
    };
  },
  async voidLabel() {},
  async track() {
    return { status: "IN_TRANSIT" };
  },
  async validateAddress(): Promise<AddressValidation> {
    return { isValid: true, messages: [] };
  },
};

function authHeaders() {
  const timestamp = Date.now();
  const signature = createHmac("sha256", authSecret)
    .update(`${managerClerkId}.${timestamp}`)
    .digest("hex");
  return {
    "x-test-clerk-user-id": managerClerkId,
    "x-test-auth-token": `${timestamp}.${signature}`,
  };
}

async function run() {
  const year = 5000 + Number.parseInt(runKey.slice(0, 4), 16);
  const staff = await prisma.staffUser.create({
    data: {
      clerkUserId: managerClerkId,
      email: `p8-${runKey}@example.test`,
      displayName: "P8 Manager",
      role: "MANAGER",
      status: "ACTIVE",
      confirmedAt: new Date(),
    },
  });
  const season = await prisma.season.create({
    data: {
      name: `P8 ${runKey}`,
      year,
      status: "OPEN",
      fulfillmentMethods: {
        create: {
          code: "SHIPPING",
          displayName: "Shipping",
          isShipping: true,
        },
      },
      packageTypes: {
        create: {
          name: `P8 box ${runKey}`,
          innerWidthMm: 100,
          innerHeightMm: 100,
          innerDepthMm: 100,
          maxWeightGrams: 600,
        },
      },
    },
    include: { fulfillmentMethods: true },
  });
  const product = await prisma.product.create({
    data: {
      seasonId: season.id,
      sku: `P8-${runKey}`,
      name: "P8 shipping gift",
      kind: "PACKAGE",
      priceCents: 5000,
      widthMm: 100,
      heightMm: 100,
      depthMm: 100,
      weightGrams: 500,
      tracksInventory: false,
    },
  });
  const customer = await prisma.customer.create({
    data: {
      displayName: "P8 Customer",
      email: `customer-${runKey}@example.test`,
      emailNormalized: `customer-${runKey}@example.test`,
      addresses: {
        create: {
          recipientName: "P8 Recipient",
          line1: "770 Eastern Parkway",
          city: "Brooklyn",
          region: "NY",
          postalCode: "11219",
          normalizedKey: `770-eastern-${runKey}`,
        },
      },
    },
    include: { addresses: true },
  });
  const address = customer.addresses[0]!;
  const method = season.fulfillmentMethods[0]!;
  const order = await prisma.order.create({
    data: {
      seasonId: season.id,
      customerId: customer.id,
      status: "FINALIZED",
      orderNumber: 1,
      draftReference: `D-P8-${runKey}`,
      subtotalCents: 10_000,
      totalCents: 12_499,
      finalizedAt: new Date(),
      lines: {
        create: {
          productId: product.id,
          recipientAddressId: address.id,
          recipientSource: "ADDRESS_BOOK",
          recipientNameSnapshot: address.recipientName,
          fulfillmentMethodId: method.id,
          fulfillmentFeeCentsSnapshot: 2499,
          greetingSnapshot: "A freilichen Purim!",
          productNameSnapshot: product.name,
          skuSnapshot: product.sku,
          unitPriceCentsSnapshot: product.priceCents,
          quantity: 2,
        },
      },
    },
    include: { lines: true },
  });
  const packageRecord = await prisma.package.create({
    data: {
      orderId: order.id,
      recipientAddressId: address.id,
      fulfillmentMethodId: method.id,
      recipientName: address.recipientName,
      addressSnapshot: {
        line1: address.line1,
        city: address.city,
        region: address.region,
        postalCode: address.postalCode,
        countryCode: address.countryCode,
      },
      greetingSnapshot: "A freilichen Purim!",
      groupingKey: `p8-${runKey}`,
      stage: "PRINTED",
      lines: {
        create: { orderLineId: order.lines[0]!.id, quantity: 2 },
      },
    },
  });

  const margin = await quotePackage(prisma, provider, packageRecord.id);
  assert.equal(margin.chargedCents, 2499);
  assert.equal(margin.purchasedCents, 1815);
  assert.equal(margin.marginCents, 684);
  await assert.rejects(
    buyPackageLabel(
      prisma,
      {
        ...provider,
        async buyLabel() {
          throw new Error("Fixture carrier timeout.");
        },
      },
      packageRecord.id,
      staff.id,
    ),
    /Fixture carrier timeout/,
  );
  assert.equal(
    await prisma.shippingLabel.count({
      where: { packageId: packageRecord.id, status: "FAILED" },
    }),
    1,
  );
  const label = await buyPackageLabel(prisma, provider, packageRecord.id, staff.id);
  assert.equal(label.provider, "ups");
  assert.equal(label.marginCents, 684);
  assert.equal(
    await prisma.shipmentBox.count({ where: { packageId: packageRecord.id } }),
    2,
  );
  console.log("S1 PASS charged highest FedEx 2499; bought cheapest UPS 1815; stored exact 684 margin; planned 2 boxes; retained failed attempt");

  await voidPackageLabel(prisma, provider, packageRecord.id, staff.id);
  const replacement = await buyPackageLabel(prisma, provider, packageRecord.id, staff.id);
  assert.notEqual(replacement.providerTransactionId, label.providerTransactionId);
  const draftFees = await quoteDraftShipping(prisma, provider, order.id);
  assert.equal(draftFees[address.id], 2499);
  const checkoutFees = calculateFulfillmentFees(
    [{ orderLineId: order.lines[0]!.id, fulfillmentCode: "SHIPPING", greeting: "" }],
    new Map([[order.lines[0]!.id, address.id]]),
    new Map(Object.entries(draftFees)),
  );
  assert.equal(checkoutFees.get(order.lines[0]!.id), 2499);
  console.log("S2 PASS label voided and rebought; checkout resolution used live 2499 charge");

  const validation = await validatePackageAddress(
    prisma,
    provider,
    packageRecord.id,
    staff.id,
  );
  assert.equal(validation.isValid, true);
  const tracked = await refreshPackageTracking(prisma, provider, packageRecord.id);
  assert.equal(tracked.trackingStatus, "IN_TRANSIT");
  await voidPackageLabel(prisma, provider, packageRecord.id, staff.id);
  assert.equal(
    (
      await prisma.shippingLabel.findUniqueOrThrow({
        where: { id: replacement.id },
      })
    ).status,
    "VOIDED",
  );
  const pageResponse = await fetch(
    `http://127.0.0.1:3101/admin/orders/${order.id}`,
    { headers: authHeaders() },
  );
  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /Shipping packages/);
  console.log("S3 PASS printed/unshipped label voided; address validated; tracking refreshed; order detail rendered shipping controls");
}

run()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
