import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { PackageStage, Prisma, type PrismaClient } from "@prisma/client";
import { captureCustomerNotification, captureEmailAndSms } from "@/domain/delivery-notifications";
import { enqueueTransactionalEmail } from "@/domain/messaging";
import { voidPackageLabel } from "@/domain/shipping";
import type { ShippingProvider } from "@/lib/shippo";

const routeLinkLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const pinLockMs = 15 * 60 * 1000;
const nearbyMiles = 0.5;

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function pinHash(tokenHash: string, pin: string) {
  return hash(`${tokenHash}:${pin}`);
}

function equalHashes(left: string, right: string) {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function addressText(snapshot: Prisma.JsonValue) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Delivery requires an address snapshot.");
  }
  const address = snapshot as Record<string, Prisma.JsonValue>;
  return [
    address.line1,
    address.line2,
    address.city,
    address.region,
    address.postalCode,
    address.countryCode ?? "US",
  ]
    .filter(Boolean)
    .map(String)
    .join(", ");
}

export function googleMapsUrl(snapshot: Prisma.JsonValue) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addressText(snapshot))}`;
}

async function geocodePackage(prisma: PrismaClient, packageId: string) {
  const packageRecord = await prisma.package.findUniqueOrThrow({
    where: { id: packageId },
    include: { recipientAddress: true, fulfillmentMethod: true },
  });
  if (
    !packageRecord.isActive ||
    packageRecord.fulfillmentMethod.isShipping ||
    packageRecord.fulfillmentMethod.isPickup
  ) {
    throw new Error("Routes accept active delivery packages only.");
  }
  const savedAddress = packageRecord.recipientAddress;
  if (savedAddress?.latitude && savedAddress.longitude) {
    return {
      packageRecord,
      latitude: Number(savedAddress.latitude),
      longitude: Number(savedAddress.longitude),
    };
  }
  const normalizedKey = savedAddress?.normalizedKey ?? hash(addressText(packageRecord.addressSnapshot));
  const cached = await prisma.geocodeCache.findFirst({
    where: {
      normalizedKey,
      expiresAt: { gt: new Date() },
      latitude: { not: null },
      longitude: { not: null },
    },
  });
  if (cached?.latitude && cached.longitude) {
    return {
      packageRecord,
      latitude: Number(cached.latitude),
      longitude: Number(cached.longitude),
    };
  }
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) {
    throw new Error("MAPBOX_ACCESS_TOKEN is required when an address has no cached coordinates.");
  }
  const response = await fetch(
    `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(addressText(packageRecord.addressSnapshot))}&limit=1&access_token=${encodeURIComponent(token)}`,
  );
  if (!response.ok) throw new Error("Mapbox could not geocode the delivery address.");
  const payload = (await response.json()) as {
    features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: { full_address?: string } }>;
  };
  const coordinates = payload.features?.[0]?.geometry?.coordinates;
  if (!coordinates) throw new Error("Mapbox returned no match for the delivery address.");
  await prisma.geocodeCache.upsert({
    where: { normalizedKey },
    create: {
      normalizedKey,
      provider: "mapbox",
      latitude: coordinates[1],
      longitude: coordinates[0],
      formattedAddress: payload.features?.[0]?.properties?.full_address,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    update: {
      provider: "mapbox",
      latitude: coordinates[1],
      longitude: coordinates[0],
      formattedAddress: payload.features?.[0]?.properties?.full_address,
      failureCode: null,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  return { packageRecord, latitude: coordinates[1], longitude: coordinates[0] };
}

export async function createDeliveryRoute(
  prisma: PrismaClient,
  input: {
    name: string;
    packageIds: string[];
    assignedDriverId?: string;
    pin: string;
    actorStaffId: string;
  },
) {
  if (!input.name.trim() || !input.packageIds.length) {
    throw new Error("A route name and at least one package are required.");
  }
  if (!/^\d{4}$/.test(input.pin)) {
    throw new Error("A four-digit driver PIN is required.");
  }
  const geocoded = await Promise.all(
    [...new Set(input.packageIds)].map((packageId) => geocodePackage(prisma, packageId)),
  );
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hash(token);
  const route = await prisma.deliveryRoute.create({
    data: {
      name: input.name.trim(),
      assignedDriverId: input.assignedDriverId,
      stops: {
        create: geocoded.map((entry, index) => ({
          packageId: entry.packageRecord.id,
          sequence: index + 1,
          latitude: entry.latitude,
          longitude: entry.longitude,
        })),
      },
      links: {
        create: {
          tokenHash,
          pinHash: pinHash(tokenHash, input.pin),
          expiresAt: new Date(Date.now() + routeLinkLifetimeMs),
        },
      },
    },
    include: { links: true, stops: true },
  });
  await prisma.auditLog.create({
    data: {
      actorStaffId: input.actorStaffId,
      action: "delivery.route_created",
      targetType: "DeliveryRoute",
      targetId: route.id,
      metadata: { packageIds: input.packageIds, linkId: route.links[0]!.id },
    },
  });
  return { route, token };
}

export async function reassignDeliveryRoute(
  prisma: PrismaClient,
  routeId: string,
  assignedDriverId: string | null,
  actorStaffId: string,
) {
  const route = await prisma.deliveryRoute.update({
    where: { id: routeId },
    data: { assignedDriverId },
  });
  await prisma.auditLog.create({
    data: {
      actorStaffId,
      action: "delivery.route_reassigned",
      targetType: "DeliveryRoute",
      targetId: routeId,
      metadata: { assignedDriverId },
    },
  });
  return route;
}

export async function accessDriverRoute(
  prisma: PrismaClient,
  token: string,
  pin?: string,
) {
  const tokenHash = hash(token);
  const link = await prisma.driverMagicLink.findUnique({
    where: { tokenHash },
    include: {
      route: {
        include: {
          stops: {
            orderBy: { sequence: "asc" },
            include: { package: true },
          },
        },
      },
    },
  });
  const now = new Date();
  if (
    !link ||
    link.expiredAt ||
    link.expiresAt <= now ||
    link.route.status === "COMPLETED"
  ) {
    throw new Error("This driver link has expired.");
  }
  if (link.lockedUntil && link.lockedUntil > now) {
    throw new Error("Too many wrong PIN attempts. Try again later.");
  }
  if (!link.pinHash) {
    throw new Error("This driver link has no PIN. Ask a manager to issue a new link.");
  }
  const isCorrect = pin ? equalHashes(link.pinHash, pinHash(tokenHash, pin)) : false;
  if (!isCorrect) {
    const failedAttempts = link.failedAttempts + 1;
    await prisma.driverMagicLink.update({
      where: { id: link.id },
      data: {
        failedAttempts,
        lockedUntil: failedAttempts >= 5 ? new Date(Date.now() + pinLockMs) : null,
      },
    });
    throw new Error("The driver PIN is incorrect.");
  }
  await prisma.driverMagicLink.update({
    where: { id: link.id },
    data: { failedAttempts: 0, lockedUntil: null, lastUsedAt: now },
  });
  return {
    linkId: link.id,
    route: {
      id: link.route.id,
      name: link.route.name,
      status: link.route.status,
      stops: link.route.stops.map((stop) => ({
        id: stop.id,
        sequence: stop.sequence,
        status: stop.status,
        recipientName: stop.package.recipientName,
        greeting: stop.package.greetingSnapshot,
        address: addressText(stop.package.addressSnapshot),
        googleMapsUrl: googleMapsUrl(stop.package.addressSnapshot),
      })),
    },
  };
}

export async function startDeliveryRoute(
  prisma: PrismaClient,
  token: string,
  pin?: string,
) {
  const access = await accessDriverRoute(prisma, token, pin);
  return prisma.$transaction(async (transaction) => {
    const route = await transaction.deliveryRoute.update({
      where: { id: access.route.id },
      data: {
        status: "IN_PROGRESS",
        startedAt: { set: new Date() },
        dayOfNotificationsAt: { set: new Date() },
      },
      include: {
        stops: {
          include: {
            package: { include: { order: { include: { customer: true } } } },
          },
        },
      },
    });
    for (const stop of route.stops) {
      const customer = stop.package.order.customer;
      await captureCustomerNotification(transaction, {
        customerId: customer.id,
        packageId: stop.package.id,
        eventKey: `route-start:${route.id}:${stop.package.id}`,
        channel: "EMAIL",
        destination: customer.email,
        payload: { routeId: route.id, type: "DAY_OF_DELIVERY" },
      });
    }
    return route;
  });
}

export async function markStopDelivered(
  prisma: PrismaClient,
  token: string,
  stopId: string,
  pin?: string,
) {
  const access = await accessDriverRoute(prisma, token, pin);
  if (!access.route.stops.some((stop) => stop.id === stopId)) {
    throw new Error("That stop is outside this driver link.");
  }
  return prisma.$transaction(async (transaction) => {
    const deliveredAt = new Date();
    const claimed = await transaction.deliveryStop.updateMany({
      where: { id: stopId, status: "PENDING" },
      data: { status: "DELIVERED", deliveredAt },
    });
    if (claimed.count !== 1) {
      throw new Error("That stop was already delivered.");
    }
    const stop = await transaction.deliveryStop.findUniqueOrThrow({
      where: { id: stopId },
    });
    await transaction.package.update({
      where: { id: stop.packageId },
      data: { stage: PackageStage.SENT, version: { increment: 1 } },
    });
    await transaction.driverDeliveryAudit.create({
      data: {
        routeId: access.route.id,
        stopId,
        linkId: access.linkId,
        deliveredAt,
      },
    });
    const remaining = await transaction.deliveryStop.count({
      where: { routeId: access.route.id, status: "PENDING" },
    });
    const completed = remaining === 0;
    if (completed) {
      await transaction.deliveryRoute.update({
        where: { id: access.route.id },
        data: { status: "COMPLETED", completedAt: deliveredAt },
      });
      await transaction.driverMagicLink.updateMany({
        where: { routeId: access.route.id, expiredAt: null },
        data: { expiredAt: deliveredAt },
      });
    }
    return { ...stop, completed };
  });
}

export async function switchFulfillmentMethod(
  prisma: PrismaClient,
  provider: ShippingProvider | null,
  input: {
    packageId: string;
    fulfillmentMethodId: string;
    actorStaffId: string;
  },
) {
  const current = await prisma.package.findUniqueOrThrow({
    where: { id: input.packageId },
    include: {
      fulfillmentMethod: true,
      shippingLabels: { where: { status: "PURCHASED" }, take: 1 },
    },
  });
  if (current.stage === "SENT" || current.stage === "PICKED_UP") {
    throw new Error("A fulfilled package cannot change method.");
  }
  const target = await prisma.fulfillmentMethod.findUniqueOrThrow({
    where: { id: input.fulfillmentMethodId },
  });
  if (target.seasonId !== (await prisma.order.findUniqueOrThrow({ where: { id: current.orderId } })).seasonId) {
    throw new Error("The fulfillment method belongs to another season.");
  }
  if (current.shippingLabels.length) {
    if (!provider) throw new Error("Shippo is required to void the active label before rerouting.");
    await voidPackageLabel(prisma, provider, current.id, input.actorStaffId);
  }
  return prisma.$transaction(async (transaction) => {
    const updated = await transaction.package.update({
      where: { id: current.id },
      data: {
        fulfillmentMethodId: target.id,
        groupingKey: `${current.groupingKey}:method:${Date.now()}`,
        version: { increment: 1 },
      },
    });
    await transaction.packageAudit.create({
      data: {
        packageId: current.id,
        actorStaffId: input.actorStaffId,
        action: "fulfillment.method_switched",
        metadata: {
          fromMethodId: current.fulfillmentMethodId,
          toMethodId: target.id,
          paidChargePreserved: true,
        },
      },
    });
    return updated;
  });
}

function distanceMiles(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(left.latitude)) *
      Math.cos(radians(right.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export async function findNearbyShippingPackages(prisma: PrismaClient, routeId: string) {
  const route = await prisma.deliveryRoute.findUniqueOrThrow({
    where: { id: routeId },
    include: { stops: { include: { package: true } } },
  });
  const candidates = await prisma.package.findMany({
    where: {
      isActive: true,
      stage: { notIn: ["SENT", "PICKED_UP"] },
      fulfillmentMethod: { isShipping: true },
      deliveryStop: null,
      recipientAddress: { latitude: { not: null }, longitude: { not: null } },
    },
    include: { recipientAddress: true },
    take: 200,
  });
  return candidates.filter((candidate) => {
    const address = candidate.recipientAddress!;
    return route.stops.some((stop) => {
      const sameStreet =
        address.line1.split(/\s+/).slice(1).join(" ").toLowerCase() ===
        addressText(stop.package.addressSnapshot).split(",")[0]!.split(/\s+/).slice(1).join(" ").toLowerCase();
      return (
        sameStreet ||
        distanceMiles(
          { latitude: Number(stop.latitude), longitude: Number(stop.longitude) },
          { latitude: Number(address.latitude), longitude: Number(address.longitude) },
        ) <= nearbyMiles
      );
    });
  });
}

export async function confirmRouteReroute(
  prisma: PrismaClient,
  provider: ShippingProvider | null,
  input: {
    routeId: string;
    packageId: string;
    deliveryMethodId: string;
    actorStaffId: string;
  },
) {
  const route = await prisma.deliveryRoute.findUniqueOrThrow({
    where: { id: input.routeId },
    select: { status: true },
  });
  if (route.status === "COMPLETED") {
    throw new Error("A completed route cannot be rerouted.");
  }
  const suggestions = await findNearbyShippingPackages(prisma, input.routeId);
  if (!suggestions.some((entry) => entry.id === input.packageId)) {
    throw new Error("The package is not an eligible nearby reroute suggestion.");
  }
  await switchFulfillmentMethod(prisma, provider, {
    packageId: input.packageId,
    fulfillmentMethodId: input.deliveryMethodId,
    actorStaffId: input.actorStaffId,
  });
  const geocoded = await geocodePackage(prisma, input.packageId);
  return prisma.$transaction(async (transaction) => {
    const lastStop = await transaction.deliveryStop.findFirst({
      where: { routeId: input.routeId },
      orderBy: { sequence: "desc" },
    });
    const stop = await transaction.deliveryStop.create({
      data: {
        routeId: input.routeId,
        packageId: input.packageId,
        sequence: (lastStop?.sequence ?? 0) + 1,
        latitude: geocoded.latitude,
        longitude: geocoded.longitude,
      },
    });
    await transaction.deliveryRoute.update({
      where: { id: input.routeId },
      data: { printRevision: { increment: 1 } },
    });
    return stop;
  });
}

export async function markPickupReady(
  prisma: PrismaClient,
  packageId: string,
  pickupLocationId: string,
) {
  const packageRecord = await prisma.package.findUniqueOrThrow({
    where: { id: packageId },
    include: {
      fulfillmentMethod: true,
      order: { include: { customer: true } },
      lines: { include: { orderLine: { include: { product: { include: { inventoryItem: true } } } } } },
    },
  });
  if (!packageRecord.fulfillmentMethod.isPickup) {
    throw new Error("Only pickup packages can be marked ready.");
  }
  const isAvailable = packageRecord.lines.every(({ quantity, orderLine }) => {
    const inventory = orderLine.product.inventoryItem;
    return !orderLine.product.tracksInventory || Boolean(inventory && inventory.onHand - inventory.reserved >= quantity);
  });
  if (!isAvailable) throw new Error("Pickup inventory is not yet available.");
  return prisma.$transaction(async (transaction) => {
    const readyAt = packageRecord.pickupReadyAt ?? new Date();
    const updated = await transaction.package.update({
      where: { id: packageId },
      data: {
        pickupLocationId,
        pickupReadyAt: readyAt,
        pickupReadyNotifiedAt: packageRecord.pickupReadyNotifiedAt ?? new Date(),
        pickupExpiresAt: new Date(readyAt.getTime() + 14 * 24 * 60 * 60 * 1000),
      },
    });
    await captureCustomerNotification(transaction, {
      customerId: packageRecord.order.customer.id,
      packageId,
      eventKey: `pickup-ready:${packageId}`,
      channel: "EMAIL",
      destination: packageRecord.order.customer.email,
      payload: { type: "PICKUP_READY", pickupLocationId },
    });
    return updated;
  });
}

export async function stampPickup(
  prisma: PrismaClient,
  packageId: string,
  actorStaffId: string,
) {
  return prisma.$transaction(async (transaction) => {
    const packageRecord = await transaction.package.findUniqueOrThrow({ where: { id: packageId } });
    if (!packageRecord.pickupReadyAt) throw new Error("Pickup must be ready before it is stamped.");
    if (
      packageRecord.pickupExpiredAt ||
      (packageRecord.pickupExpiresAt && packageRecord.pickupExpiresAt <= new Date())
    ) {
      throw new Error("An expired pickup cannot be stamped.");
    }
    const updated = await transaction.package.update({
      where: { id: packageId },
      data: { stage: "PICKED_UP", version: { increment: 1 } },
    });
    await transaction.packageAudit.create({
      data: {
        packageId,
        actorStaffId,
        action: "pickup.collected",
        fromStage: packageRecord.stage,
        toStage: "PICKED_UP",
      },
    });
    return updated;
  });
}

export async function scheduleBulkDelivery(
  prisma: PrismaClient,
  packageId: string,
  start: Date,
  end: Date,
) {
  if (end <= start) throw new Error("Bulk delivery window must end after it starts.");
  const packageRecord = await prisma.package.findUniqueOrThrow({
    where: { id: packageId },
    include: { order: { include: { customer: true } } },
  });
  await prisma.package.update({
    where: { id: packageId },
    data: { bulkDeliveryStart: start, bulkDeliveryEnd: end },
  });
  const customer = packageRecord.order.customer;
  await captureEmailAndSms(prisma, {
    customerId: customer.id,
    packageId,
    eventKey: `bulk-scheduled:${packageId}:${start.toISOString()}`,
    email: customer.email,
    phone: customer.phone,
    payload: { type: "BULK_DELIVERY_SCHEDULED", start, end },
  });
}

export async function expireUnclaimedPickups(prisma: PrismaClient, now = new Date()) {
  const expired = await prisma.package.findMany({
    where: {
      pickupReadyAt: { not: null },
      pickupExpiresAt: { lte: now },
      pickupExpiredAt: null,
      stage: { not: "PICKED_UP" },
    },
    select: { id: true },
  });
  let expiredCount = 0;
  for (const packageRecord of expired) {
    expiredCount += await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.package.updateMany({
        where: { id: packageRecord.id, pickupExpiredAt: null },
        data: { pickupExpiredAt: now },
      });
      if (!claimed.count) return 0;
      await transaction.packageAudit.create({
        data: { packageId: packageRecord.id, action: "pickup.expired", metadata: { expiredAt: now } },
      });
      return 1;
    });
  }
  return expiredCount;
}

export async function sendPaymentReminders(prisma: PrismaClient) {
  const orders = await prisma.order.findMany({
    where: {
      status: "FINALIZED",
      cachedPaymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] },
      customer: { email: { not: null } },
    },
    include: { customer: true },
    take: 500,
  });
  for (const order of orders) {
    await enqueueTransactionalEmail(prisma, {
      idempotencyKey: `payment-reminder:${order.id}:${new Date().toISOString().slice(0, 10)}`,
      templateKey: "order.payment_link",
      recipient: order.customer.email,
      customerId: order.customer.id,
      orderId: order.id,
      variables: {
        orderNumber: order.orderNumber ?? order.draftReference,
        paymentUrl: `${process.env.APP_URL ?? "http://127.0.0.1:3101"}/account/orders/${order.id}`,
      },
    });
  }
  return orders.length;
}
