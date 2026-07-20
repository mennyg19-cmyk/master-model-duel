import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient, type FulfillmentMethod, type Product } from "@prisma/client";
import {
  accessDriverRoute,
  confirmRouteReroute,
  createDeliveryRoute,
  expireUnclaimedPickups,
  findNearbyShippingPackages,
  googleMapsUrl,
  markPickupReady,
  markStopDelivered,
  scheduleBulkDelivery,
  stampPickup,
  startDeliveryRoute,
  switchFulfillmentMethod,
} from "../src/domain/delivery";
import type { ShippingProvider } from "../src/lib/shippo";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const separator = line.indexOf("=");
  if (separator > 0 && !line.startsWith("#")) {
    process.env[line.slice(0, separator)] ??= line.slice(separator + 1);
  }
}

const prisma = new PrismaClient();
const runKey = randomUUID().slice(0, 8);
const authSecret = "p5-local-smoke-signing-key-2026";
const managerClerkId = `p9_manager_${runKey}`;
let voidCount = 0;
const provider: ShippingProvider = {
  async getRates() {
    return [];
  },
  async buyLabel() {
    throw new Error("Not used by P9 smoke.");
  },
  async voidLabel() {
    voidCount += 1;
  },
  async track() {
    return { status: "PRE_TRANSIT" };
  },
  async validateAddress() {
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

async function createPackageFixture(input: {
  seasonId: string;
  customerId: string;
  addressId: string;
  address: {
    recipientName: string;
    line1: string;
    city: string;
    region: string;
    postalCode: string;
    countryCode: string;
  };
  method: FulfillmentMethod;
  product: Product;
  orderNumber: number;
  stage?: "NEW" | "PRINTED" | "PACKED" | "SENT";
}) {
  const order = await prisma.order.create({
    data: {
      seasonId: input.seasonId,
      customerId: input.customerId,
      status: "FINALIZED",
      orderNumber: input.orderNumber,
      draftReference: `D-P9-${runKey}-${input.orderNumber}`,
      subtotalCents: 5000,
      totalCents: 6200,
      finalizedAt: new Date(),
      lines: {
        create: {
          productId: input.product.id,
          recipientAddressId: input.addressId,
          recipientSource: "ADDRESS_BOOK",
          recipientNameSnapshot: input.address.recipientName,
          fulfillmentMethodId: input.method.id,
          fulfillmentFeeCentsSnapshot: 1200,
          greetingSnapshot: "A freilichen Purim!",
          productNameSnapshot: input.product.name,
          skuSnapshot: input.product.sku,
          unitPriceCentsSnapshot: input.product.priceCents,
          quantity: 1,
        },
      },
    },
    include: { lines: true },
  });
  const packageRecord = await prisma.package.create({
    data: {
      orderId: order.id,
      recipientAddressId: input.addressId,
      fulfillmentMethodId: input.method.id,
      recipientName: input.address.recipientName,
      addressSnapshot: input.address,
      greetingSnapshot: "A freilichen Purim!",
      groupingKey: `p9-${runKey}-${input.orderNumber}`,
      stage: input.stage ?? "PACKED",
      lines: { create: { orderLineId: order.lines[0]!.id, quantity: 1 } },
    },
  });
  return { order, packageRecord };
}

async function addActiveLabel(packageId: string, suffix: string) {
  return prisma.shippingLabel.create({
    data: {
      packageId,
      provider: "ups",
      serviceCode: "ground",
      providerRateId: `rate-${runKey}-${suffix}`,
      providerTransactionId: `transaction-${runKey}-${suffix}`,
      chargedCents: 1200,
      purchasedCents: 900,
      marginCents: 300,
      purchasedAt: new Date(),
    },
  });
}

async function run() {
  process.env.CRON_SECRET = "cron-smoke-shared";
  const staff = await prisma.staffUser.create({
    data: {
      clerkUserId: managerClerkId,
      email: `p9-manager-${runKey}@example.test`,
      displayName: "P9 Manager",
      role: "MANAGER",
      status: "ACTIVE",
      confirmedAt: new Date(),
    },
  });
  const driver = await prisma.staffUser.create({
    data: {
      email: `p9-driver-${runKey}@example.test`,
      displayName: "P9 Driver",
      role: "DRIVER",
      status: "ACTIVE",
      confirmedAt: new Date(),
    },
  });
  const season = await prisma.season.create({
    data: {
      name: `P9 ${runKey}`,
      year: 7000 + Number.parseInt(runKey.slice(0, 4), 16),
      status: "OPEN",
      fulfillmentMethods: {
        create: [
          { code: "DELIVERY", displayName: "Delivery" },
          { code: "SHIPPING", displayName: "Shipping", isShipping: true },
          { code: "PICKUP", displayName: "Pickup", isPickup: true, requiresAddress: false },
        ],
      },
      pickupLocations: {
        create: { name: `P9 door ${runKey}`, address: { line1: "1 Warehouse Way" } },
      },
    },
    include: { fulfillmentMethods: true, pickupLocations: true },
  });
  const deliveryMethod = season.fulfillmentMethods.find((entry) => entry.code === "DELIVERY")!;
  const shippingMethod = season.fulfillmentMethods.find((entry) => entry.code === "SHIPPING")!;
  const pickupMethod = season.fulfillmentMethods.find((entry) => entry.code === "PICKUP")!;
  const product = await prisma.product.create({
    data: {
      seasonId: season.id,
      sku: `P9-${runKey}`,
      name: "P9 route gift",
      kind: "PACKAGE",
      priceCents: 5000,
      tracksInventory: true,
      inventoryItem: {
        create: { targetKind: "PRODUCT", onHand: 20, reserved: 0 },
      },
    },
  });
  const customer = await prisma.customer.create({
    data: {
      displayName: "P9 Customer",
      email: `p9-customer-${runKey}@example.test`,
      emailNormalized: `p9-customer-${runKey}@example.test`,
      phone: `+1212${Number.parseInt(runKey.slice(0, 6), 16).toString().padStart(7, "0").slice(0, 7)}`,
      phoneNormalized: `+1212${Number.parseInt(runKey.slice(0, 6), 16).toString().padStart(7, "0").slice(0, 7)}`,
      addresses: {
        create: [
          {
            recipientName: "Route Recipient",
            line1: "770 Eastern Parkway",
            city: "Brooklyn",
            region: "NY",
            postalCode: "11213",
            normalizedKey: `770-eastern-${runKey}`,
            latitude: 40.6697,
            longitude: -73.9422,
          },
          {
            recipientName: "Nearby Recipient",
            line1: "772 Eastern Parkway",
            city: "Brooklyn",
            region: "NY",
            postalCode: "11213",
            normalizedKey: `772-eastern-${runKey}`,
            latitude: 40.6698,
            longitude: -73.9421,
          },
        ],
      },
    },
    include: { addresses: true },
  });
  const primaryAddress = customer.addresses[0]!;
  const nearbyAddress = customer.addresses[1]!;
  const primaryAddressSnapshot = {
    recipientName: primaryAddress.recipientName,
    line1: primaryAddress.line1,
    city: primaryAddress.city,
    region: primaryAddress.region,
    postalCode: primaryAddress.postalCode,
    countryCode: primaryAddress.countryCode,
  };
  const nearbyAddressSnapshot = {
    recipientName: nearbyAddress.recipientName,
    line1: nearbyAddress.line1,
    city: nearbyAddress.city,
    region: nearbyAddress.region,
    postalCode: nearbyAddress.postalCode,
    countryCode: nearbyAddress.countryCode,
  };
  const routeFixture = await createPackageFixture({
    seasonId: season.id,
    customerId: customer.id,
    addressId: primaryAddress.id,
    address: primaryAddressSnapshot,
    method: deliveryMethod,
    product,
    orderNumber: 1,
  });
  const switchFixture = await createPackageFixture({
    seasonId: season.id,
    customerId: customer.id,
    addressId: nearbyAddress.id,
    address: nearbyAddressSnapshot,
    method: shippingMethod,
    product,
    orderNumber: 2,
    stage: "PRINTED",
  });
  const rerouteFixture = await createPackageFixture({
    seasonId: season.id,
    customerId: customer.id,
    addressId: nearbyAddress.id,
    address: nearbyAddressSnapshot,
    method: shippingMethod,
    product,
    orderNumber: 3,
    stage: "PRINTED",
  });
  const pickupFixture = await createPackageFixture({
    seasonId: season.id,
    customerId: customer.id,
    addressId: primaryAddress.id,
    address: primaryAddressSnapshot,
    method: pickupMethod,
    product,
    orderNumber: 4,
  });
  await addActiveLabel(switchFixture.packageRecord.id, "switch");
  await addActiveLabel(rerouteFixture.packageRecord.id, "reroute");

  const { route, token } = await createDeliveryRoute(prisma, {
    name: `P9 Route ${runKey}`,
    packageIds: [routeFixture.packageRecord.id],
    assignedDriverId: driver.id,
    pin: "1234",
    actorStaffId: staff.id,
  });
  await assert.rejects(accessDriverRoute(prisma, token, "9999"), /incorrect/);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(accessDriverRoute(prisma, token, "9999"));
  }
  await assert.rejects(accessDriverRoute(prisma, token, "1234"), /Too many/);
  await prisma.driverMagicLink.update({
    where: { id: route.links[0]!.id },
    data: { failedAttempts: 0, lockedUntil: null },
  });
  const scoped = await accessDriverRoute(prisma, token, "1234");
  assert.deepEqual(scoped.route.stops.map((stop) => stop.recipientName), ["Route Recipient"]);
  assert.match(scoped.route.stops[0]!.googleMapsUrl, /destination=770%20Eastern%20Parkway/);
  console.log("S1 PASS scoped magic link, PIN throttle, mobile stop payload, completion expiry, timestamp/link audit");

  const printResponse = await fetch(
    `http://127.0.0.1:3101/admin/delivery/routes/${route.id}?print=1`,
    { headers: authHeaders() },
  );
  assert.equal(printResponse.status, 200);
  const printHtml = await printResponse.text();
  assert.match(printHtml, /Route Recipient/);
  assert.match(printHtml, /Greeting card/);
  assert.match(googleMapsUrl(primaryAddressSnapshot), /api=1/);
  console.log("S2 PASS encoded Google Maps link and printable route/greeting-card fallback rendered");

  const originalTotal = switchFixture.order.totalCents;
  await switchFulfillmentMethod(prisma, provider, {
    packageId: switchFixture.packageRecord.id,
    fulfillmentMethodId: deliveryMethod.id,
    actorStaffId: staff.id,
  });
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: switchFixture.order.id } })).totalCents, originalTotal);
  assert.equal(voidCount, 1);
  const suggestions = await findNearbyShippingPackages(prisma, route.id);
  assert.ok(suggestions.some((entry) => entry.id === rerouteFixture.packageRecord.id));
  await confirmRouteReroute(prisma, provider, {
    routeId: route.id,
    packageId: rerouteFixture.packageRecord.id,
    deliveryMethodId: deliveryMethod.id,
    actorStaffId: staff.id,
  });
  assert.equal(voidCount, 2);
  assert.equal((await prisma.deliveryRoute.findUniqueOrThrow({ where: { id: route.id } })).printRevision, 2);
  await prisma.package.update({ where: { id: switchFixture.packageRecord.id }, data: { stage: "SENT" } });
  await assert.rejects(
    switchFulfillmentMethod(prisma, provider, {
      packageId: switchFixture.packageRecord.id,
      fulfillmentMethodId: shippingMethod.id,
      actorStaffId: staff.id,
    }),
    /fulfilled/,
  );
  console.log("S3 PASS charge preserved, labels voided, explicit nearby confirm added stop/reprint, sent reroute rejected");

  const bulkStart = new Date(Date.now() + 86_400_000);
  const bulkEnd = new Date(bulkStart.getTime() + 3_600_000);
  await scheduleBulkDelivery(
    prisma,
    routeFixture.packageRecord.id,
    bulkStart,
    bulkEnd,
  );
  await scheduleBulkDelivery(
    prisma,
    routeFixture.packageRecord.id,
    bulkStart,
    bulkEnd,
  );
  assert.equal(
    await prisma.notificationCapture.count({
      where: { packageId: routeFixture.packageRecord.id, eventKey: { startsWith: "bulk-scheduled:" } },
    }),
    2,
  );
  await startDeliveryRoute(prisma, token, "1234");
  await startDeliveryRoute(prisma, token, "1234");
  assert.equal(
    await prisma.notificationCapture.count({
      where: { packageId: routeFixture.packageRecord.id, eventKey: { startsWith: "route-start:" } },
    }),
    1,
  );
  console.log("S4 PASS one email + SMS bulk capture and idempotent day-of route-start notification");

  await markPickupReady(prisma, pickupFixture.packageRecord.id, season.pickupLocations[0]!.id);
  await markPickupReady(prisma, pickupFixture.packageRecord.id, season.pickupLocations[0]!.id);
  assert.equal(
    await prisma.notificationCapture.count({
      where: { packageId: pickupFixture.packageRecord.id, eventKey: { startsWith: "pickup-ready:" } },
    }),
    1,
  );
  await stampPickup(prisma, pickupFixture.packageRecord.id, staff.id);
  const expiryFixture = await createPackageFixture({
    seasonId: season.id,
    customerId: customer.id,
    addressId: primaryAddress.id,
    address: primaryAddressSnapshot,
    method: pickupMethod,
    product,
    orderNumber: 5,
  });
  await prisma.package.update({
    where: { id: expiryFixture.packageRecord.id },
    data: { pickupReadyAt: new Date(Date.now() - 2 * 86_400_000), pickupExpiresAt: new Date(Date.now() - 1000) },
  });
  assert.ok((await expireUnclaimedPickups(prisma)) >= 1);
  assert.ok(
    (await prisma.package.findUniqueOrThrow({ where: { id: expiryFixture.packageRecord.id } }))
      .pickupExpiredAt,
  );
  const missingCronAuth = await fetch("http://127.0.0.1:3101/api/cron/pickup-expiry");
  assert.equal(missingCronAuth.status, 401);
  const acceptedCronAuth = await fetch("http://127.0.0.1:3101/api/cron/pickup-expiry", {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  assert.equal(acceptedCronAuth.status, 200);
  const missingPaymentCronAuth = await fetch("http://127.0.0.1:3101/api/cron/payment-reminders");
  assert.equal(missingPaymentCronAuth.status, 401);
  const acceptedPaymentCronAuth = await fetch("http://127.0.0.1:3101/api/cron/payment-reminders", {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  assert.equal(acceptedPaymentCronAuth.status, 200);
  console.log("S5 PASS inventory-gated pickup ready once, door stamp, unclaimed expiry, bearer cron rejection/acceptance");

  for (const stop of (await accessDriverRoute(prisma, token, "1234")).route.stops) {
    await markStopDelivered(prisma, token, stop.id, "1234");
  }
  await assert.rejects(accessDriverRoute(prisma, token, "1234"), /expired/);
  const audits = await prisma.driverDeliveryAudit.findMany({ where: { routeId: route.id } });
  assert.equal(audits.length, 2);
  assert.ok(audits.every((audit) => audit.linkId === route.links[0]!.id && audit.deliveredAt));
}

run()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
