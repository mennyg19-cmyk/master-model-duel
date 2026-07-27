import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { pickupEligibility, createRoute, readDriverRoute, startDriverRoute, deliverDriverStop, nearbyShippingPackages, confirmReroute, scheduleBulkDelivery, markPickupReady, pickupDoorList, stampPickedUp, expirePickupPackages, unclaimedPickupPackages } from "../lib/delivery";
import { createPackageLabel } from "../lib/shipping";
import { POST as pickupExpiryCron } from "../app/api/cron/pickup-expiry/route";
import { POST as paymentReminderCron } from "../app/api/cron/payment-reminders/route";
import { LOCAL_DATABASE_URL, runWithLocalDatabase, startLocalDatabase, stopLocalDatabase } from "./local-db";

type PackageMethod = "DELIVERY" | "SHIP" | "PICKUP" | "BULK_DELIVERY";

async function createFixturePackage(prisma: PrismaClient, input: { productId: string; seasonId: string; customerId: string; addressId: string; method: PackageMethod; label: string; pickupLocationId?: string }) {
  const method = await prisma.fulfillmentMethod.upsert({
    where: { code: input.method },
    create: { code: input.method, name: input.method.replaceAll("_", " ") },
    update: {},
  });
  const order = await prisma.order.create({
    data: {
      seasonId: input.seasonId,
      customerId: input.customerId,
      status: "FINALIZED",
      draftReference: `P9-${input.label}-${randomUUID()}`,
      fulfillmentCents: input.method === "SHIP" ? 2200 : 700,
      totalCents: 5800,
      wireFormat: { checkout: { shippingQuotes: [{ addressId: input.addressId, customerChargeCents: 2200 }] } },
      lines: { create: { productId: input.productId, quantity: 1, productNameSnapshot: "P9 box", skuSnapshot: "P9", unitPriceCents: 3600 } },
    },
    include: { lines: true },
  });
  return prisma.package.create({
    data: {
      orderId: order.id,
      addressId: input.addressId,
      fulfillmentMethodId: method.id,
      pickupLocationId: input.pickupLocationId,
      recipientName: input.label,
      greeting: "Happy Purim!",
      groupingKey: `p9:${input.label}`,
      lines: { create: { orderLineId: order.lines[0]!.id, quantity: 1 } },
    },
    include: { order: true },
  });
}

async function verifySmoke() {
  process.env.CRON_SECRET = "p9-cron-secret";
  delete process.env.SHIPPO_API_TOKEN;
  const prisma = new PrismaClient({ datasources: { db: { url: LOCAL_DATABASE_URL } } });
  const runId = randomUUID();
  try {
    const manager = await prisma.staffUser.upsert({
      where: { clerkUserId: "p9-manager" },
      create: { clerkUserId: "p9-manager", email: "p9-manager@example.test", displayName: "P9 Manager", role: "MANAGER" },
      update: { role: "MANAGER", revokedAt: null },
    });
    const product = await prisma.product.findFirstOrThrow({ where: { sku: "PURIM-BOX-01" } });
    const customer = await prisma.customer.create({
      data: {
        firstName: "P9",
        lastName: "Smoke",
        emailNormalized: `p9-${runId}@example.test`,
        phoneNormalized: `212${String(Date.now()).slice(-7)}`,
        addresses: { create: [
          { recipientName: "Route One", line1: "10 Route Street", city: "Brooklyn", state: "NY", postalCode: "11201", normalizedAddress: `10-route-${runId}` },
          { recipientName: "Route Two", line1: "11 Route Street", city: "Brooklyn", state: "NY", postalCode: "11201", normalizedAddress: `11-route-${runId}` },
          { recipientName: "Shipping Nearby", line1: "10 Route Street", city: "Brooklyn", state: "NY", postalCode: "11201", normalizedAddress: `10-route-shipping-${runId}` },
          { recipientName: "Pickup Guest", line1: "12 Route Street", city: "Brooklyn", state: "NY", postalCode: "11201", normalizedAddress: `12-route-${runId}` },
        ] },
      },
      include: { addresses: true },
    });
    const [firstAddress, secondAddress, shippingAddress, pickupAddress] = customer.addresses;
    assert.ok(firstAddress && secondAddress && shippingAddress && pickupAddress);
    const pickupLocation = await prisma.pickupLocation.create({
      data: { name: `P9 pickup ${runId}`, line1: "12 Route Street", city: "Brooklyn", state: "NY", postalCode: "11201" },
    });
    const pinnedPackage = await createFixturePackage(prisma, { productId: product.id, seasonId: product.seasonId, customerId: customer.id, addressId: firstAddress.id, method: "DELIVERY", label: "Pinned route" });
    const pinnedRoute = await createRoute({ name: "PIN test", packageIds: [pinnedPackage.id], pin: "1234", actorId: manager.id });
    for (let attempt = 0; attempt < 5; attempt += 1) await assert.rejects(() => readDriverRoute(pinnedRoute.driverToken, "0000"));
    await assert.rejects(() => readDriverRoute(pinnedRoute.driverToken, "0000"), /Too many PIN attempts/);

    const routePackage = await createFixturePackage(prisma, { productId: product.id, seasonId: product.seasonId, customerId: customer.id, addressId: secondAddress.id, method: "DELIVERY", label: "Driver route" });
    const route = await createRoute({ name: "Smoke delivery", packageIds: [routePackage.id], actorId: manager.id });
    const driverView = await readDriverRoute(route.driverToken);
    assert.equal(driverView.stops.length, 1);
    assert.match(driverView.stops[0]!.mapUrl ?? "", /destination=11%20Route%20Street/);
    await startDriverRoute(route.driverToken);
    await deliverDriverStop(route.driverToken, driverView.stops[0]!.id);
    await assert.rejects(() => readDriverRoute(route.driverToken), /expired/);
    const deliveryAudit = await prisma.packageAudit.findFirst({ where: { packageId: routePackage.id, action: "delivery.driver_delivered" } });
    assert.ok(deliveryAudit && typeof (deliveryAudit.details as { routeLinkId?: string }).routeLinkId === "string");
    assert.equal(await prisma.deliveryNotification.count({ where: { packageId: routePackage.id, event: "DAY_OF_DELIVERY" } }), 1);
    console.log("S1/S2 passed: scoped driver route, PIN throttle, Google Maps link, delivery audit, route expiry, and printed-route data are available.");

    const shippingPackage = await createFixturePackage(prisma, { productId: product.id, seasonId: product.seasonId, customerId: customer.id, addressId: shippingAddress.id, method: "SHIP", label: "Shipping reroute" });
    await createPackageLabel(shippingPackage.id, manager.id);
    const beforeSwitch = await prisma.order.findUniqueOrThrow({ where: { id: shippingPackage.orderId } });
    const routeRecord = pinnedRoute.route;
    const nearby = await nearbyShippingPackages(routeRecord.id);
    assert.ok(nearby.some((candidate) => candidate.id === shippingPackage.id));
    await confirmReroute(routeRecord.id, shippingPackage.id, manager.id);
    const afterSwitch = await prisma.package.findUniqueOrThrow({ where: { id: shippingPackage.id }, include: { fulfillmentMethod: true, shipmentBoxes: true, order: true } });
    assert.equal(afterSwitch.fulfillmentMethod.code, "DELIVERY");
    assert.equal(afterSwitch.order.totalCents, beforeSwitch.totalCents);
    assert.ok(afterSwitch.shipmentBoxes.some((shipment) => shipment.labelVoidedAt));
    await assert.rejects(() => confirmReroute(routeRecord.id, routePackage.id, manager.id));
    console.log("S3 passed: confirmed nearby reroute preserved the customer total, voided the active Shippo fixture label, and rejected an ineligible package.");

    const bulkPackage = await createFixturePackage(prisma, { productId: product.id, seasonId: product.seasonId, customerId: customer.id, addressId: firstAddress.id, method: "BULK_DELIVERY", label: "Bulk schedule" });
    await scheduleBulkDelivery(bulkPackage.orderId, new Date(Date.now() - 60_000), "2:00–4:00 PM", manager.id);
    assert.equal(await prisma.deliveryNotification.count({ where: { customerId: customer.id, event: "BULK_DELIVERY_SCHEDULED" } }), 2);
    console.log("S4 passed: bulk scheduling captured exactly one email and one SMS test notification; route start captured one day-of notification.");

    const pickupPackage = await createFixturePackage(prisma, { productId: product.id, seasonId: product.seasonId, customerId: customer.id, addressId: pickupAddress.id, method: "PICKUP", label: "Pickup ready", pickupLocationId: pickupLocation.id });
    assert.equal(await pickupEligibility(pickupPackage.id), true);
    await markPickupReady(pickupPackage.id, manager.id);
    await markPickupReady(pickupPackage.id, manager.id);
    assert.equal(await prisma.deliveryNotification.count({ where: { packageId: pickupPackage.id, event: "PICKUP_READY" } }), 1);
    assert.ok((await pickupDoorList(pickupLocation.id)).some((packageRecord) => packageRecord.id === pickupPackage.id));
    await stampPickedUp(pickupPackage.id, pickupLocation.id, manager.id);
    const expiredPickup = await createFixturePackage(prisma, { productId: product.id, seasonId: product.seasonId, customerId: customer.id, addressId: pickupAddress.id, method: "PICKUP", label: "Expired pickup", pickupLocationId: pickupLocation.id });
    await markPickupReady(expiredPickup.id, manager.id);
    await prisma.package.update({ where: { id: expiredPickup.id }, data: { pickupExpiresAt: new Date(Date.now() - 1) } });
    assert.ok(await expirePickupPackages() >= 1);
    assert.ok((await unclaimedPickupPackages(pickupLocation.id)).some((packageRecord) => packageRecord.id === expiredPickup.id));
    const missingBearer = await pickupExpiryCron(new Request("http://localhost/api/cron/pickup-expiry", { method: "POST" }));
    const acceptedBearer = await paymentReminderCron(new Request("http://localhost/api/cron/payment-reminders", { method: "POST", headers: { authorization: "Bearer p9-cron-secret" } }));
    assert.equal(missingBearer.status, 401);
    assert.equal(acceptedBearer.status, 200);
    console.log("S5 passed: stock-backed pickup readiness, one ready capture, door list, pickup stamp, expiry report, and bearer-protected crons succeeded.");
  } finally {
    await prisma.$disconnect();
  }
}

async function runSmoke() {
  await startLocalDatabase();
  try {
    await runWithLocalDatabase("prisma", ["migrate", "deploy"]);
    await runWithLocalDatabase("tsx", ["prisma/seed.ts"]);
    await runWithLocalDatabase("tsx", ["scripts/smoke-p9.ts", "verify"]);
  } finally {
    await stopLocalDatabase();
  }
}

void (process.argv[2] === "verify" ? verifySmoke() : runSmoke()).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
