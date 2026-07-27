import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createPdf } from "@/lib/print-batches";
import { checkoutChargeForPackage, voidPackageLabel } from "@/lib/shipping";
import { dispatchSms } from "@/lib/sms";

const DELIVERY_CODES = ["DELIVERY", "LOCAL_DELIVERY"];
const MAGIC_LINK_TTL_MS = 24 * 60 * 60 * 1_000;
const PICKUP_EXPIRY_MS = 7 * 24 * 60 * 60 * 1_000;
const PIN_ATTEMPT_LIMIT = 5;
const PIN_THROTTLE_MS = 15 * 60 * 1_000;
const PROXIMITY_MILES = 0.5;
const EARTH_RADIUS_MILES = 3_958.8;

type Address = {
  id: string;
  normalizedAddress: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  latitude: Prisma.Decimal | null;
  longitude: Prisma.Decimal | null;
};

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function timingSafeMatches(expectedHash: string, candidate: string) {
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(hashSecret(candidate), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function addressLabel(address: Pick<Address, "line1" | "line2" | "city" | "state" | "postalCode">) {
  return [address.line1, address.line2, address.city, address.state, address.postalCode].filter(Boolean).join(", ");
}

function mapLink(address: Pick<Address, "line1" | "line2" | "city" | "state" | "postalCode">) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addressLabel(address))}`;
}

function fixtureCoordinates(normalizedAddress: string) {
  const digest = createHash("sha256").update(normalizedAddress).digest();
  return {
    latitude: 40.68 + digest[0] / 10_000,
    longitude: -73.99 + digest[1] / 10_000,
  };
}

function shouldUseFixtureGeocodes() {
  return process.env.TEST_MODE === "true" && process.env.NODE_ENV !== "production";
}

async function mapboxCoordinates(address: Address) {
  const accessToken = process.env.MAPBOX_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("MAPBOX_ACCESS_TOKEN must be configured to create routes from ungeocoded addresses.");
  }
  const query = new URLSearchParams({
    q: addressLabel(address),
    country: "US",
    limit: "1",
    access_token: accessToken,
  });
  const response = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${query}`);
  if (!response.ok) throw new Error("Mapbox could not resolve this address. Confirm it before creating a route.");
  const body = await response.json() as { features?: Array<{ geometry?: { coordinates?: unknown } }> };
  const coordinates = body.features?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || typeof coordinates[0] !== "number" || typeof coordinates[1] !== "number") {
    throw new Error("Mapbox could not resolve this address. Confirm it before creating a route.");
  }
  return { latitude: coordinates[1], longitude: coordinates[0], provider: "mapbox" };
}

async function geocodeAddress(address: Address) {
  const cached = await prisma.geocodeCache.findFirst({
    where: { normalizedAddress: address.normalizedAddress, expiresAt: { gt: new Date() } },
  });
  const coordinates = cached && (cached.provider !== "fixture" || shouldUseFixtureGeocodes())
    ? { latitude: Number(cached.latitude), longitude: Number(cached.longitude), provider: cached.provider }
    : shouldUseFixtureGeocodes()
      ? { ...fixtureCoordinates(address.normalizedAddress), provider: "fixture" }
      : await mapboxCoordinates(address);
  if (!cached || cached.provider === "fixture") {
    await prisma.geocodeCache.upsert({
      where: { normalizedAddress: address.normalizedAddress },
      create: {
        normalizedAddress: address.normalizedAddress,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        provider: coordinates.provider,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
      },
      update: {
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        provider: coordinates.provider,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
      },
    });
  }
  await prisma.address.update({
    where: { id: address.id },
    data: { latitude: coordinates.latitude, longitude: coordinates.longitude, geocodedAt: new Date() },
  });
  return coordinates;
}

function isWithinHalfMile(left: { latitude: number; longitude: number }, right: { latitude: number; longitude: number }) {
  const radians = Math.PI / 180;
  const latitudeDelta = (right.latitude - left.latitude) * radians;
  const longitudeDelta = (right.longitude - left.longitude) * radians;
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(left.latitude * radians) * Math.cos(right.latitude * radians) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= PROXIMITY_MILES;
}

async function captureNotification(input: {
  packageId?: string;
  customerId?: string;
  event: string;
  channel: string;
  dedupeKey: string;
  payload: Prisma.InputJsonValue;
}) {
  if (input.channel === "SMS") return dispatchSms(input);
  return prisma.deliveryNotification.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: input,
    update: {},
  });
}

async function deliveryMethod() {
  return prisma.fulfillmentMethod.upsert({
    where: { code: "DELIVERY" },
    create: { code: "DELIVERY", name: "Local delivery" },
    update: { name: "Local delivery" },
  });
}

async function loadDriverLink(token: string, pin?: string) {
  const link = await prisma.driverRouteLink.findUnique({
    where: { tokenHash: hashSecret(token) },
    include: { route: { include: { stops: { include: { package: { include: { address: true } } }, orderBy: { sequence: "asc" } } } } },
  });
  if (!link || (link.expiresAt && link.expiresAt <= new Date()) || link.route.completedAt) {
    throw new Error("This driver link has expired.");
  }
  if (!link.pinHash) return link;
  if (link.throttledUntil && link.throttledUntil > new Date()) {
    throw new Error("Too many PIN attempts. Wait before trying again.");
  }
  if (!pin || !timingSafeMatches(link.pinHash, pin)) {
    const failedAttempts = link.failedAttempts + 1;
    const throttledUntil = failedAttempts >= PIN_ATTEMPT_LIMIT ? new Date(Date.now() + PIN_THROTTLE_MS) : null;
    await prisma.driverRouteLink.update({
      where: { id: link.id },
      data: {
        failedAttempts,
        throttledUntil,
      },
    });
    await prisma.auditEvent.create({
      data: {
        action: "delivery.driver_pin_failed",
        subjectId: link.routeId,
        details: { driverRouteLinkId: link.id, failedAttempts, throttledUntil: throttledUntil?.toISOString() ?? null },
      },
    });
    throw new Error("Enter the route PIN.");
  }
  if (link.failedAttempts) {
    await prisma.driverRouteLink.update({ where: { id: link.id }, data: { failedAttempts: 0, throttledUntil: null } });
  }
  return link;
}

export async function createRoute(input: { name: string; packageIds: string[]; driverId?: string; pin?: string; actorId: string }) {
  const uniquePackageIds = [...new Set(input.packageIds)];
  if (!uniquePackageIds.length) throw new Error("Select at least one delivery package.");
  const packages = await prisma.package.findMany({
    where: {
      id: { in: uniquePackageIds },
      isActive: true,
      status: { not: "SENT" },
      fulfillmentMethod: { code: { in: DELIVERY_CODES } },
      deliveryStop: null,
      order: { status: "FINALIZED" },
    },
    include: { address: true },
  });
  if (packages.length !== uniquePackageIds.length || packages.some((packageRecord) => !packageRecord.address)) {
    throw new Error("Every selected package must be an unassigned local-delivery package with an address.");
  }
  const coordinates = await Promise.all(packages.map((packageRecord) => geocodeAddress(packageRecord.address!)));
  const ordered = packages
    .map((packageRecord, index) => ({ packageRecord, coordinates: coordinates[index]! }))
    .sort((left, right) => left.coordinates.latitude - right.coordinates.latitude || left.coordinates.longitude - right.coordinates.longitude);
  const token = randomBytes(32).toString("base64url");
  const route = await prisma.$transaction(async (transaction) => {
    const created = await transaction.deliveryRoute.create({
      data: {
        name: input.name.trim(),
        driverId: input.driverId,
        createdById: input.actorId,
        stops: { create: ordered.map(({ packageRecord }, index) => ({ packageId: packageRecord.id, sequence: index + 1 })) },
        links: {
          create: {
            tokenHash: hashSecret(token),
            pinHash: input.pin ? hashSecret(input.pin) : null,
            expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
          },
        },
      },
      include: { links: true, stops: true },
    });
    await transaction.auditEvent.create({
      data: { actorId: input.actorId, action: "delivery.route_created", subjectId: created.id, details: { packageIds: uniquePackageIds, geocodeProviders: [...new Set(coordinates.map((coordinate) => coordinate.provider))] } },
    });
    return created;
  });
  return { route, driverToken: token, driverUrl: `/driver/${token}` };
}

export async function listRoutes() {
  return prisma.deliveryRoute.findMany({
    include: {
      driver: { select: { displayName: true } },
      stops: { include: { package: { include: { address: true } } }, orderBy: { sequence: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function reassignRoute(routeId: string, driverId: string | null, actorId: string) {
  const route = await prisma.deliveryRoute.update({ where: { id: routeId }, data: { driverId } });
  await prisma.auditEvent.create({ data: { actorId, action: "delivery.route_reassigned", subjectId: route.id, details: { driverId } } });
  return route;
}

export async function routePrintDocument(routeId: string, includeGreetingCards = false) {
  const route = await prisma.deliveryRoute.findUniqueOrThrow({
    where: { id: routeId },
    include: { stops: { include: { package: { include: { address: true } } }, orderBy: { sequence: "asc" } } },
  });
  return {
    title: includeGreetingCards ? `Greeting cards · ${route.name}` : `Driver route · ${route.name}`,
    lines: route.stops.flatMap((stop) => {
      const address = stop.package.address;
      if (!address) return [`${stop.sequence}. ${stop.package.recipientName} · address unavailable`];
      return includeGreetingCards
        ? [`To ${stop.package.recipientName}`, stop.package.greeting || "Warm wishes"]
        : [`${stop.sequence}. ${stop.package.recipientName}`, addressLabel(address), mapLink(address), stop.deliveredAt ? "Delivered" : "Pending"];
    }),
  };
}

export async function routePdf(routeId: string, includeGreetingCards = false) {
  return createPdf(await routePrintDocument(routeId, includeGreetingCards));
}

export async function readDriverRoute(token: string, pin?: string) {
  const link = await loadDriverLink(token, pin);
  return {
    route: { id: link.route.id, name: link.route.name, status: link.route.status, startedAt: link.route.startedAt },
    stops: link.route.stops.map((stop) => ({
      id: stop.id,
      sequence: stop.sequence,
      recipientName: stop.package.recipientName,
      greeting: stop.package.greeting,
      deliveredAt: stop.deliveredAt,
      mapUrl: stop.package.address ? mapLink(stop.package.address) : null,
      address: stop.package.address ? addressLabel(stop.package.address) : "Address unavailable",
    })),
  };
}

export async function startDriverRoute(token: string, pin?: string) {
  const link = await loadDriverLink(token, pin);
  if (link.route.status !== "DRAFT" && link.route.status !== "ACTIVE") {
    throw new Error("Only a draft or active route can be started.");
  }
  const route = await prisma.deliveryRoute.update({
    where: { id: link.routeId },
    data: { status: "ACTIVE", startedAt: link.route.startedAt ?? new Date() },
    include: { stops: { include: { package: { include: { order: true } } } } },
  });
  await Promise.all(route.stops.map((stop) => captureNotification({
    packageId: stop.packageId,
    customerId: stop.package.order.customerId ?? undefined,
    event: "DAY_OF_DELIVERY",
    channel: "TEST_CAPTURE",
    dedupeKey: `day-of-route-start:${stop.packageId}`,
    payload: { routeId: route.id },
  })));
  return route;
}

export async function deliverDriverStop(token: string, stopId: string, pin?: string) {
  const link = await loadDriverLink(token, pin);
  const stop = await prisma.deliveryRouteStop.findFirst({
    where: { id: stopId, routeId: link.routeId },
    include: { package: true },
  });
  if (!stop) throw new Error("This stop is not part of the driver route.");
  if (!stop.deliveredAt) {
    await prisma.$transaction(async (transaction) => {
      await transaction.deliveryRouteStop.update({ where: { id: stop.id }, data: { deliveredAt: new Date() } });
      if (stop.package.status !== "SENT") {
        await transaction.package.update({ where: { id: stop.packageId }, data: { status: "SENT", version: { increment: 1 } } });
      }
      await transaction.packageAudit.create({
        data: { packageId: stop.packageId, action: "delivery.driver_delivered", details: { routeId: link.routeId, routeLinkId: link.id } },
      });
    });
  }
  const remaining = await prisma.deliveryRouteStop.count({ where: { routeId: link.routeId, deliveredAt: null } });
  if (!remaining) {
    await prisma.$transaction([
      prisma.deliveryRoute.update({ where: { id: link.routeId }, data: { status: "COMPLETED", completedAt: new Date() } }),
      prisma.driverRouteLink.update({ where: { id: link.id }, data: { expiresAt: new Date() } }),
    ]);
  }
}

export async function switchPackageMethod(packageId: string, methodCode: "SHIP" | "DELIVERY", actorId: string) {
  const packageRecord = await prisma.package.findFirst({
    where: { id: packageId, isActive: true, order: { status: "FINALIZED" } },
    include: {
      fulfillmentMethod: true,
      order: { select: { wireFormat: true } },
      shipmentBoxes: { where: { externalLabelId: { not: null }, labelVoidedAt: null } },
    },
  });
  if (!packageRecord || packageRecord.status === "SENT") throw new Error("Sent packages cannot change fulfillment method.");
  if (packageRecord.fulfillmentMethod.code === methodCode) return packageRecord;
  const preservedCustomerChargeCents = packageRecord.fulfillmentMethod.code === "SHIP"
    ? checkoutChargeForPackage(packageRecord)
    : null;
  const voidedLabelId = packageRecord.shipmentBoxes[0]?.externalLabelId ?? null;
  if (packageRecord.fulfillmentMethod.code === "SHIP" && packageRecord.shipmentBoxes.length) {
    await voidPackageLabel(packageId, actorId);
  }
  const method = methodCode === "DELIVERY"
    ? await deliveryMethod()
    : await prisma.fulfillmentMethod.upsert({ where: { code: "SHIP" }, create: { code: "SHIP", name: "Ship" }, update: { name: "Ship" } });
  return prisma.$transaction(async (transaction) => {
    const updated = await transaction.package.update({
      where: { id: packageId },
      data: { fulfillmentMethodId: method.id, version: { increment: 1 } },
    });
    await transaction.packageAudit.create({
      data: {
        packageId,
        actorId,
        action: "delivery.method_switched",
        details: {
          from: packageRecord.fulfillmentMethod.code,
          to: methodCode,
          preservedCustomerChargeCents,
          voidedLabelId,
        },
      },
    });
    return updated;
  });
}

export async function nearbyShippingPackages(routeId: string) {
  const route = await prisma.deliveryRoute.findFirstOrThrow({
    where: { id: routeId, status: { in: ["DRAFT", "ACTIVE"] } },
    include: { stops: { include: { package: { include: { address: true } } } } },
  });
  const routeAddresses = route.stops.flatMap((stop) => stop.package.address ? [stop.package.address] : []);
  const routeCoordinates = await Promise.all(routeAddresses.map((address) => geocodeAddress(address)));
  const candidates = await prisma.package.findMany({
    where: { isActive: true, status: { not: "SENT" }, fulfillmentMethod: { code: "SHIP" }, deliveryStop: null },
    include: { address: true },
  });
  const nearby = (await Promise.all(candidates.map(async (candidate) => {
    const address = candidate.address;
    if (!address) return null;
    const coordinates = await geocodeAddress(address);
    const isSameStreet = routeAddresses.some((routeAddress) =>
      routeAddress.line1 === address.line1 && routeAddress.city === address.city && routeAddress.state === address.state,
    );
    if (isSameStreet || routeCoordinates.some((routeCoordinate) => isWithinHalfMile(routeCoordinate, coordinates))) {
      return candidate;
    }
    return null;
  }))).filter((candidate): candidate is (typeof candidates)[number] => candidate !== null);
  return nearby;
}

export async function confirmReroute(routeId: string, packageId: string, actorId: string) {
  const route = await prisma.deliveryRoute.findFirst({
    where: { id: routeId, status: { in: ["DRAFT", "ACTIVE"] } },
    select: { id: true },
  });
  if (!route) throw new Error("Only a draft or active route can accept a reroute.");
  const suggested = await nearbyShippingPackages(routeId);
  if (!suggested.some((candidate) => candidate.id === packageId)) {
    throw new Error("This package is not an eligible nearby, unshipped shipping package.");
  }
  await switchPackageMethod(packageId, "DELIVERY", actorId);
  return prisma.$transaction(async (transaction) => {
    const sequence = (await transaction.deliveryRouteStop.aggregate({ where: { routeId }, _max: { sequence: true } }))._max.sequence ?? 0;
    const stop = await transaction.deliveryRouteStop.create({ data: { routeId, packageId, sequence: sequence + 1 } });
    await transaction.auditEvent.create({ data: { actorId, action: "delivery.reroute_confirmed", subjectId: routeId, details: { packageId, stopId: stop.id } } });
    return stop;
  });
}

export async function scheduleBulkDelivery(orderId: string, deliveryDate: Date, window: string, actorId: string) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { customer: true, packages: { include: { fulfillmentMethod: true } } },
  });
  const packages = order.packages.filter((packageRecord) => packageRecord.fulfillmentMethod.code === "BULK_DELIVERY");
  if (!packages.length) throw new Error("This order has no bulk delivery packages to schedule.");
  const schedule = await prisma.bulkDeliverySchedule.create({ data: { orderId, deliveryDate, window, scheduledById: actorId } });
  if (order.customer) {
    await Promise.all(["EMAIL", "SMS"].map((channel) => captureNotification({
      customerId: order.customer!.id,
      event: "BULK_DELIVERY_SCHEDULED",
      channel,
      dedupeKey: `bulk-delivery:${schedule.id}:${order.customer!.id}:${channel}`,
      payload: { orderId, deliveryDate: deliveryDate.toISOString(), window },
    })));
  }
  return schedule;
}

export async function pickupEligibility(packageId: string) {
  const packageRecord = await prisma.package.findUniqueOrThrow({
    where: { id: packageId },
    include: {
      fulfillmentMethod: true,
      lines: { include: { orderLine: { include: { product: { include: { inventoryItems: true } } } } } },
    },
  });
  if (packageRecord.fulfillmentMethod.code !== "PICKUP") return false;
  return packageRecord.lines.every((line) => {
    const inventory = line.orderLine.product.inventoryItems[0];
    return Boolean(inventory && inventory.quantityOnHand - inventory.quantityReserved >= line.quantity);
  });
}

export async function markPickupReady(packageId: string, actorId: string) {
  if (!await pickupEligibility(packageId)) throw new Error("Pickup inventory is not available yet.");
  const packageRecord = await prisma.package.findUniqueOrThrow({ where: { id: packageId }, include: { order: true, fulfillmentMethod: true } });
  if (packageRecord.fulfillmentMethod.code !== "PICKUP" || !packageRecord.pickupLocationId) {
    throw new Error("A pickup package needs an assigned pickup location before it can be made ready.");
  }
  const readyAt = packageRecord.pickupReadyAt ?? new Date();
  await prisma.package.update({ where: { id: packageId }, data: { pickupReadyAt: readyAt, pickupExpiresAt: packageRecord.pickupExpiresAt ?? new Date(Date.now() + PICKUP_EXPIRY_MS) } });
  await captureNotification({
    packageId,
    customerId: packageRecord.order.customerId ?? undefined,
    event: "PICKUP_READY",
    channel: "TEST_CAPTURE",
    dedupeKey: `pickup-ready:${packageId}`,
    payload: { packageId },
  });
  await prisma.packageAudit.create({ data: { packageId, actorId, action: "pickup.ready", details: {} } });
}

export async function pickupDoorList(pickupLocationId: string) {
  return prisma.package.findMany({
    where: { pickupLocationId, pickupReadyAt: { not: null }, pickupExpiresAt: { gt: new Date() } },
    include: {
      pickupLocation: true,
      order: { include: { customer: true } },
      audits: { where: { action: "pickup.stamped" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { recipientName: "asc" },
  });
}

export async function stampPickedUp(packageId: string, pickupLocationId: string, actorId: string) {
  const packageRecord = await prisma.package.findUniqueOrThrow({ where: { id: packageId }, include: { fulfillmentMethod: true } });
  if (packageRecord.fulfillmentMethod.code !== "PICKUP" || packageRecord.pickupLocationId !== pickupLocationId || !packageRecord.pickupReadyAt || packageRecord.status === "SENT") {
    throw new Error("This package is not ready for pickup at this location.");
  }
  await prisma.$transaction([
    prisma.package.update({ where: { id: packageId }, data: { status: "PICKED_UP", version: { increment: 1 } } }),
    prisma.packageAudit.create({ data: { packageId, actorId, action: "pickup.stamped", details: {} } }),
  ]);
}

export async function expirePickupPackages() {
  const now = new Date();
  const overdue = await prisma.package.findMany({
    where: {
      fulfillmentMethod: { code: "PICKUP" },
      pickupExpiresAt: { lt: now },
      status: { notIn: ["PICKED_UP", "SENT", "UNCLAIMED"] },
    },
  });
  await Promise.all(overdue.map(async (packageRecord) => {
    await prisma.$transaction(async (transaction) => {
      const expired = await transaction.package.updateMany({
        where: { id: packageRecord.id, status: { notIn: ["PICKED_UP", "SENT", "UNCLAIMED"] } },
        data: { status: "UNCLAIMED", version: { increment: 1 } },
      });
      if (expired.count) {
        await transaction.packageAudit.create({
          data: {
            packageId: packageRecord.id,
            action: "pickup.expired",
            details: { expiredAt: now.toISOString(), pickupExpiresAt: packageRecord.pickupExpiresAt?.toISOString() ?? null },
          },
        });
      }
    });
  }));
  return overdue.length;
}

export async function unclaimedPickupPackages(pickupLocationId: string) {
  return prisma.package.findMany({
    where: { pickupLocationId, fulfillmentMethod: { code: "PICKUP" }, status: "UNCLAIMED" },
    include: { pickupLocation: true, order: { include: { customer: true } } },
    orderBy: { pickupExpiresAt: "desc" },
  });
}

export async function sendPaymentReminders() {
  const schedules = await prisma.bulkDeliverySchedule.findMany({
    where: { deliveryDate: { lte: new Date() }, order: { paymentStatus: "PENDING" } },
    include: { order: true },
  });
  await Promise.all(schedules.map((schedule) => captureNotification({
    customerId: schedule.order.customerId ?? undefined,
    event: "PAYMENT_REMINDER",
    channel: "TEST_CAPTURE",
    dedupeKey: `payment-reminder:${schedule.id}`,
    payload: { scheduleId: schedule.id, orderId: schedule.orderId },
  })));
  return schedules.length;
}
