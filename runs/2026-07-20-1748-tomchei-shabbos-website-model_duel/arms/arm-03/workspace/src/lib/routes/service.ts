import { createHash, randomBytes } from "node:crypto";
import {
  AuditAction,
  DeliveryRouteStatus,
  PackageStage,
  Prisma,
  RouteStopStatus,
  ShippingLabelStatus,
} from "@prisma/client";
import { ApiError } from "@/lib/api-error";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { captureEmailAndSms } from "@/lib/notify/outbox";
import { voidLabelForPackage } from "@/lib/shipping/labels";
import {
  geocodePackageAddress,
  googleMapsDeepLink,
  haversineMiles,
  sameStreetCluster,
} from "@/lib/routes/geo";
import { CARD_5X7, paginate, renderPdf, type PdfLine } from "@/lib/pdf";

const DELIVERY_CODES = new Set([
  "DELIVERY",
  "BULK_DELIVERY",
  "PER_PACKAGE_DELIVERY",
]);

const GRACE_MS = Number(process.env.MAGIC_LINK_GRACE_MS ?? "0");
const NEARBY_MI = 0.5;

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function hashPin(pin: string): string {
  return createHash("sha256").update(`pin:${pin}`).digest("hex");
}

function isDeliveryCode(code: string): boolean {
  return DELIVERY_CODES.has(code.toUpperCase());
}

async function ensureGeocoded(packageId: string) {
  const pkg = await db.package.findUniqueOrThrow({ where: { id: packageId } });
  if (pkg.latitude != null && pkg.longitude != null) {
    return pkg;
  }
  const geo = await geocodePackageAddress(pkg);
  return db.package.update({
    where: { id: packageId },
    data: {
      latitude: geo.latitude,
      longitude: geo.longitude,
      geocodedAt: geo.geocodedAt,
    },
  });
}

export async function listRoutes(seasonId: string) {
  return db.deliveryRoute.findMany({
    where: { seasonId },
    orderBy: { createdAt: "desc" },
    include: {
      driver: { select: { id: true, displayName: true, email: true } },
      stops: { orderBy: { sequence: "asc" } },
      magicLinks: {
        where: { revokedAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      _count: { select: { stops: true } },
    },
  });
}

export async function getRouteDetail(seasonId: string, routeId: string) {
  return db.deliveryRoute.findFirst({
    where: { id: routeId, seasonId },
    include: {
      driver: { select: { id: true, displayName: true, email: true } },
      stops: {
        orderBy: { sequence: "asc" },
        include: {
          package: {
            include: {
              fulfillmentMethod: true,
              shippingLabels: {
                where: { status: ShippingLabelStatus.PURCHASED },
                take: 1,
              },
            },
          },
        },
      },
      magicLinks: { orderBy: { createdAt: "desc" } },
    },
  });
}

/** Build a route from delivery packages (geocode + cache). */
export async function createRouteFromPackages(input: {
  seasonId: string;
  name: string;
  packageIds: string[];
  actorId?: string | null;
  pin?: string | null;
  driverStaffId?: string | null;
}) {
  if (input.packageIds.length < 1) {
    throw new ApiError("Select at least one package", 400);
  }

  const packages = await db.package.findMany({
    where: {
      id: { in: input.packageIds },
      order: { seasonId: input.seasonId },
    },
    include: { fulfillmentMethod: true, routeStop: true },
  });
  if (packages.length !== input.packageIds.length) {
    throw new ApiError("One or more packages not found in season", 404);
  }
  for (const pkg of packages) {
    if (!isDeliveryCode(pkg.fulfillmentMethod.code)) {
      throw new ApiError(
        `Package ${pkg.id} is ${pkg.fulfillmentMethod.code}, not delivery`,
        409,
      );
    }
    if (pkg.routeStop) {
      throw new ApiError(`Package ${pkg.id} already on a route`, 409);
    }
    if (pkg.stage === PackageStage.SENT || pkg.stage === PackageStage.PICKED_UP) {
      throw new ApiError(`Package ${pkg.id} already completed`, 409);
    }
  }

  const geocoded = [];
  for (const pkg of packages) {
    geocoded.push(await ensureGeocoded(pkg.id));
  }

  // Nearest-neighbor order from first package.
  const remaining = [...geocoded];
  const ordered: typeof geocoded = [];
  let current = remaining.shift()!;
  ordered.push(current);
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i]!;
      if (current.latitude == null || current.longitude == null || cand.latitude == null || cand.longitude == null) {
        bestIdx = i;
        break;
      }
      const d = haversineMiles(
        { latitude: current.latitude, longitude: current.longitude },
        { latitude: cand.latitude, longitude: cand.longitude },
      );
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    current = remaining.splice(bestIdx, 1)[0]!;
    ordered.push(current);
  }

  const route = await db.$transaction(async (tx) => {
    const created = await tx.deliveryRoute.create({
      data: {
        seasonId: input.seasonId,
        name: input.name,
        status: input.driverStaffId
          ? DeliveryRouteStatus.ASSIGNED
          : DeliveryRouteStatus.DRAFT,
        driverStaffId: input.driverStaffId ?? null,
        createdById: input.actorId ?? null,
        pinHash: input.pin ? hashPin(input.pin) : null,
      },
    });

    let seq = 1;
    for (const pkg of ordered) {
      const mapsUrl = googleMapsDeepLink(pkg);
      await tx.routeStop.create({
        data: {
          routeId: created.id,
          packageId: pkg.id,
          sequence: seq++,
          latitude: pkg.latitude,
          longitude: pkg.longitude,
          recipientName: pkg.recipientName,
          addressLine1: pkg.addressLine1,
          addressLine2: pkg.addressLine2,
          city: pkg.city,
          state: pkg.state,
          postalCode: pkg.postalCode,
          country: pkg.country,
          mapsUrl,
        },
      });
    }

    await writeAudit(
      {
        action: AuditAction.ROUTE_CREATED,
        actorId: input.actorId,
        meta: {
          routeId: created.id,
          packageIds: ordered.map((p) => p.id),
          stopCount: ordered.length,
        },
      },
      tx,
    );
    if (input.driverStaffId) {
      await writeAudit(
        {
          action: AuditAction.ROUTE_ASSIGNED,
          actorId: input.actorId,
          meta: { routeId: created.id, driverStaffId: input.driverStaffId },
        },
        tx,
      );
    }
    return created;
  });

  return getRouteDetail(input.seasonId, route.id);
}

export async function reassignRoute(input: {
  seasonId: string;
  routeId: string;
  driverStaffId: string | null;
  actorId?: string | null;
  pin?: string | null;
}) {
  const existing = await db.deliveryRoute.findFirst({
    where: { id: input.routeId, seasonId: input.seasonId },
  });
  if (!existing) throw new ApiError("Route not found", 404);
  if (existing.status === DeliveryRouteStatus.COMPLETED) {
    throw new ApiError("Cannot reassign a completed route", 409);
  }

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.deliveryRoute.update({
      where: { id: existing.id },
      data: {
        driverStaffId: input.driverStaffId,
        pinHash: input.pin ? hashPin(input.pin) : existing.pinHash,
        status:
          input.driverStaffId && existing.status === DeliveryRouteStatus.DRAFT
            ? DeliveryRouteStatus.ASSIGNED
            : existing.status,
      },
    });
    await writeAudit(
      {
        action: AuditAction.ROUTE_REASSIGNED,
        actorId: input.actorId,
        meta: {
          routeId: row.id,
          driverStaffId: input.driverStaffId,
        },
      },
      tx,
    );
    return row;
  });
  return updated;
}

export async function issueMagicLink(input: {
  seasonId: string;
  routeId: string;
  actorId?: string | null;
}): Promise<{ rawToken: string; linkId: string; url: string }> {
  const route = await db.deliveryRoute.findFirst({
    where: { id: input.routeId, seasonId: input.seasonId },
  });
  if (!route) throw new ApiError("Route not found", 404);
  if (route.status === DeliveryRouteStatus.COMPLETED) {
    throw new ApiError("Route already completed", 409);
  }

  const rawToken = randomBytes(32).toString("base64url");
  const link = await db.$transaction(async (tx) => {
    await tx.driverMagicLink.updateMany({
      where: { routeId: route.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return tx.driverMagicLink.create({
      data: {
        routeId: route.id,
        tokenHash: hashToken(rawToken),
        pinRequired: Boolean(route.pinHash),
      },
    });
  });

  const base = process.env.APP_URL?.replace(/\/$/, "") || "http://127.0.0.1:3103";
  return {
    rawToken,
    linkId: link.id,
    url: `${base}/d/${rawToken}`,
  };
}

export function isMagicLinkActive(link: {
  revokedAt: Date | null;
  completedAt: Date | null;
  graceExpiresAt: Date | null;
}): boolean {
  if (link.revokedAt) return false;
  if (!link.completedAt) return true;
  if (link.graceExpiresAt && link.graceExpiresAt > new Date()) return true;
  return false;
}

export async function loadMagicLinkSession(rawToken: string) {
  const link = await db.driverMagicLink.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: {
      route: {
        include: {
          stops: { orderBy: { sequence: "asc" } },
        },
      },
    },
  });
  if (!link) throw new ApiError("Invalid magic link", 404);
  if (!isMagicLinkActive(link)) {
    throw new ApiError("Magic link expired", 410);
  }
  await db.driverMagicLink.update({
    where: { id: link.id },
    data: { lastUsedAt: new Date() },
  });
  return link;
}

export async function verifyMagicPin(input: {
  rawToken: string;
  pin: string;
}): Promise<{ ok: true } | { ok: false; throttled: boolean }> {
  const link = await db.driverMagicLink.findUnique({
    where: { tokenHash: hashToken(input.rawToken) },
    include: { route: true },
  });
  if (!link || !isMagicLinkActive(link)) {
    throw new ApiError("Magic link expired", 410);
  }
  if (!link.pinRequired || !link.route.pinHash) {
    return { ok: true };
  }
  if (link.pinLockedUntil && link.pinLockedUntil > new Date()) {
    await db.driverDeliveryEvent.create({
      data: {
        magicLinkId: link.id,
        action: "PIN_THROTTLED",
        meta: { lockedUntil: link.pinLockedUntil.toISOString() },
      },
    });
    return { ok: false, throttled: true };
  }
  if (hashPin(input.pin) === link.route.pinHash) {
    await db.driverMagicLink.update({
      where: { id: link.id },
      data: { pinFailCount: 0, pinLockedUntil: null },
    });
    return { ok: true };
  }
  const failCount = link.pinFailCount + 1;
  const lockedUntil =
    failCount >= 3 ? new Date(Date.now() + 60_000) : null;
  await db.driverMagicLink.update({
    where: { id: link.id },
    data: {
      pinFailCount: failCount,
      pinLockedUntil: lockedUntil,
    },
  });
  await db.driverDeliveryEvent.create({
    data: {
      magicLinkId: link.id,
      action: "PIN_FAIL",
      meta: { failCount },
    },
  });
  return { ok: false, throttled: Boolean(lockedUntil) };
}

export async function startRouteViaMagicLink(input: {
  rawToken: string;
  pin?: string;
}) {
  const link = await loadMagicLinkSession(input.rawToken);
  if (link.pinRequired) {
    const pinCheck = await verifyMagicPin({
      rawToken: input.rawToken,
      pin: input.pin ?? "",
    });
    if (!pinCheck.ok) {
      throw new ApiError(
        pinCheck.throttled ? "PIN locked — try again later" : "Invalid PIN",
        401,
      );
    }
  }

  if (
    link.route.status === DeliveryRouteStatus.IN_PROGRESS ||
    link.route.status === DeliveryRouteStatus.COMPLETED
  ) {
    return link.route;
  }

  const updated = await db.$transaction(async (tx) => {
    const route = await tx.deliveryRoute.update({
      where: { id: link.routeId },
      data: {
        status: DeliveryRouteStatus.IN_PROGRESS,
        startedAt: new Date(),
      },
    });
    await tx.driverDeliveryEvent.create({
      data: {
        magicLinkId: link.id,
        action: "START_ROUTE",
      },
    });
    await writeAudit(
      {
        action: AuditAction.ROUTE_STARTED,
        meta: { routeId: route.id, magicLinkId: link.id },
      },
      tx,
    );
    return route;
  });

  await sendDayOfNotifications(link.routeId);
  return updated;
}

async function sendDayOfNotifications(routeId: string) {
  const route = await db.deliveryRoute.findUniqueOrThrow({
    where: { id: routeId },
    include: {
      stops: {
        include: {
          package: {
            include: {
              order: { include: { customer: true } },
              fulfillmentMethod: true,
            },
          },
        },
      },
    },
  });
  if (route.dayOfNotifiedAt) return { skipped: true as const };

  for (const stop of route.stops) {
    const code = stop.package.fulfillmentMethod.code.toUpperCase();
    if (code !== "PER_PACKAGE_DELIVERY" && code !== "DELIVERY") continue;
    const customer = stop.package.order.customer;
    const recipientKey =
      customer?.emailNorm ||
      customer?.phoneNorm ||
      customer?.id ||
      stop.package.orderId;
    await captureEmailAndSms({
      templateKey: "day-of-delivery",
      recipientKey,
      idempotencyBase: `day-of:${routeId}:${stop.packageId}`,
      emailSubject: "Delivery today",
      emailBody: `Your package to ${stop.recipientName} is out for delivery today.`,
      smsBody: `TS: package for ${stop.recipientName} out for delivery today.`,
      meta: { routeId, packageId: stop.packageId },
    });
  }

  await db.deliveryRoute.update({
    where: { id: routeId },
    data: { dayOfNotifiedAt: new Date() },
  });
  return { skipped: false as const };
}

export async function markStopDelivered(input: {
  rawToken: string;
  stopId: string;
  pin?: string;
}) {
  const link = await loadMagicLinkSession(input.rawToken);
  if (link.pinRequired) {
    const pinCheck = await verifyMagicPin({
      rawToken: input.rawToken,
      pin: input.pin ?? "",
    });
    if (!pinCheck.ok) {
      throw new ApiError(
        pinCheck.throttled ? "PIN locked — try again later" : "Invalid PIN",
        401,
      );
    }
  }

  const stop = link.route.stops.find((s) => s.id === input.stopId);
  if (!stop) throw new ApiError("Stop not on this route", 404);
  if (stop.status === RouteStopStatus.DELIVERED) {
    return { stop, completed: link.route.status === DeliveryRouteStatus.COMPLETED };
  }

  const result = await db.$transaction(async (tx) => {
    const updatedStop = await tx.routeStop.update({
      where: { id: stop.id },
      data: {
        status: RouteStopStatus.DELIVERED,
        deliveredAt: new Date(),
      },
    });
    await tx.package.update({
      where: { id: stop.packageId },
      data: { stage: PackageStage.SENT, version: { increment: 1 } },
    });
    await tx.driverDeliveryEvent.create({
      data: {
        magicLinkId: link.id,
        routeStopId: stop.id,
        action: "DELIVERED",
        meta: { packageId: stop.packageId },
      },
    });
    await writeAudit(
      {
        action: AuditAction.DRIVER_DELIVERED,
        meta: {
          routeId: link.routeId,
          magicLinkId: link.id,
          stopId: stop.id,
          packageId: stop.packageId,
          at: new Date().toISOString(),
        },
      },
      tx,
    );

    const pending = await tx.routeStop.count({
      where: {
        routeId: link.routeId,
        status: RouteStopStatus.PENDING,
      },
    });

    let completed = false;
    if (pending === 0) {
      const graceExpiresAt = new Date(Date.now() + GRACE_MS);
      await tx.deliveryRoute.update({
        where: { id: link.routeId },
        data: {
          status: DeliveryRouteStatus.COMPLETED,
          completedAt: new Date(),
          graceExpiresAt,
        },
      });
      await tx.driverMagicLink.updateMany({
        where: { routeId: link.routeId, revokedAt: null },
        data: {
          completedAt: new Date(),
          graceExpiresAt,
        },
      });
      await writeAudit(
        {
          action: AuditAction.ROUTE_COMPLETED,
          meta: { routeId: link.routeId, magicLinkId: link.id },
        },
        tx,
      );
      completed = true;
    }
    return { stop: updatedStop, completed };
  });

  return result;
}

/** Printed fallback — HTML/text payload + greeting-card PDF. */
export async function printRoute(input: {
  seasonId: string;
  routeId: string;
}): Promise<{ printText: string; greetingPdf: Buffer; payload: Prisma.JsonObject }> {
  const route = await getRouteDetail(input.seasonId, input.routeId);
  if (!route) throw new ApiError("Route not found", 404);

  const lines: string[] = [
    `Route: ${route.name}`,
    `Status: ${route.status}`,
    `Driver: ${route.driver?.displayName ?? "(unassigned)"}`,
    "",
    "Stops (printed fallback — no phone required):",
  ];
  for (const stop of route.stops) {
    lines.push(
      `${stop.sequence}. ${stop.recipientName}`,
      `   ${stop.addressLine1}${stop.addressLine2 ? `, ${stop.addressLine2}` : ""}`,
      `   ${stop.city}, ${stop.state} ${stop.postalCode}`,
      `   Maps: ${stop.mapsUrl}`,
      `   Status: ${stop.status}`,
      "",
    );
  }

  const cardPages: PdfLine[][] = [];
  for (const stop of route.stops) {
    const greeting = stop.package.greeting || "Happy Purim";
    cardPages.push(
      ...paginate(
        [
          { text: "Tomchei Shabbos", size: 14, bold: true },
          { text: stop.recipientName, size: 16, bold: true, gapBefore: 12 },
          { text: greeting, size: 12, gapBefore: 18 },
          {
            text: `${stop.addressLine1}, ${stop.city}`,
            size: 9,
            gapBefore: 24,
          },
        ],
        CARD_5X7,
      ),
    );
  }
  const greetingPdf = renderPdf(cardPages.length ? cardPages : [[{ text: "No stops" }]], CARD_5X7);

  const payload = {
    routeId: route.id,
    name: route.name,
    stops: route.stops.map((s) => ({
      id: s.id,
      sequence: s.sequence,
      recipientName: s.recipientName,
      addressLine1: s.addressLine1,
      city: s.city,
      state: s.state,
      postalCode: s.postalCode,
      mapsUrl: s.mapsUrl,
      status: s.status,
    })),
    printedAt: new Date().toISOString(),
  } satisfies Prisma.JsonObject;

  await db.deliveryRoute.update({
    where: { id: route.id },
    data: { printPayload: payload },
  });

  return { printText: lines.join("\n"), greetingPdf, payload };
}

/** Suggest nearby unshipped SHIP packages for reroute (manager must confirm). */
export async function suggestReroutes(input: {
  seasonId: string;
  routeId: string;
}) {
  const route = await getRouteDetail(input.seasonId, input.routeId);
  if (!route) throw new ApiError("Route not found", 404);

  const shipPkgs = await db.package.findMany({
    where: {
      order: { seasonId: input.seasonId },
      fulfillmentMethod: { code: "SHIP" },
      stage: { in: [PackageStage.NEW, PackageStage.PRINTED, PackageStage.PACKED] },
      routeStop: null,
    },
    include: {
      shippingLabels: {
        where: { status: ShippingLabelStatus.PURCHASED },
        take: 1,
      },
    },
  });

  const suggestions: Array<{
    packageId: string;
    nearStopId: string;
    reason: "distance" | "street";
    miles: number | null;
  }> = [];

  for (const pkg of shipPkgs) {
    if (pkg.stage === PackageStage.SENT) continue;
    const geo = await ensureGeocoded(pkg.id);
    for (const stop of route.stops) {
      const streetMatch = sameStreetCluster(geo, stop);
      let miles: number | null = null;
      let near = streetMatch;
      if (
        geo.latitude != null &&
        geo.longitude != null &&
        stop.latitude != null &&
        stop.longitude != null
      ) {
        miles = haversineMiles(
          { latitude: geo.latitude, longitude: geo.longitude },
          { latitude: stop.latitude, longitude: stop.longitude },
        );
        if (miles <= NEARBY_MI) near = true;
      }
      if (near) {
        suggestions.push({
          packageId: pkg.id,
          nearStopId: stop.id,
          reason: streetMatch ? "street" : "distance",
          miles,
        });
        break;
      }
    }
  }
  return suggestions;
}

/** Confirmed reroute: void printed-not-shipped label, switch to delivery, add stop. */
export async function confirmReroute(input: {
  seasonId: string;
  routeId: string;
  packageId: string;
  confirm: boolean;
  actorId?: string | null;
}) {
  if (!input.confirm) {
    throw new ApiError("Manager confirmation required for reroute", 400);
  }

  const pkg = await db.package.findFirst({
    where: { id: input.packageId, order: { seasonId: input.seasonId } },
    include: {
      fulfillmentMethod: true,
      routeStop: true,
      shippingLabels: {
        where: { status: ShippingLabelStatus.PURCHASED },
      },
    },
  });
  if (!pkg) throw new ApiError("Package not found", 404);
  if (pkg.stage === PackageStage.SENT || pkg.stage === PackageStage.PICKED_UP) {
    throw new ApiError("Sent package rejects reroute", 409);
  }
  if (pkg.routeStop) throw new ApiError("Package already on a route", 409);

  const delivery = await db.fulfillmentMethod.findUnique({
    where: { code: "PER_PACKAGE_DELIVERY" },
  });
  if (!delivery) throw new ApiError("PER_PACKAGE_DELIVERY method missing", 500);

  const geo = await ensureGeocoded(pkg.id);
  const maxSeq = await db.routeStop.aggregate({
    where: { routeId: input.routeId },
    _max: { sequence: true },
  });
  const sequence = (maxSeq._max.sequence ?? 0) + 1;
  const mapsUrl = googleMapsDeepLink(geo);

  const stop = await db.$transaction(async (tx) => {
    // Void printed-not-shipped label inside the same tx as method + stop (label integrity).
    if (pkg.shippingLabels.length > 0) {
      await voidLabelForPackage({
        packageId: pkg.id,
        actorId: input.actorId,
        seasonId: input.seasonId,
        tx,
      });
    }
    await tx.package.update({
      where: { id: pkg.id },
      data: {
        fulfillmentMethodId: delivery.id,
        version: { increment: 1 },
      },
    });
    const created = await tx.routeStop.create({
      data: {
        routeId: input.routeId,
        packageId: pkg.id,
        sequence,
        latitude: geo.latitude,
        longitude: geo.longitude,
        recipientName: geo.recipientName,
        addressLine1: geo.addressLine1,
        addressLine2: geo.addressLine2,
        city: geo.city,
        state: geo.state,
        postalCode: geo.postalCode,
        country: geo.country,
        mapsUrl,
      },
    });
    await writeAudit(
      {
        action: AuditAction.REROUTE_CONFIRMED,
        actorId: input.actorId,
        meta: {
          routeId: input.routeId,
          packageId: pkg.id,
          fromMethod: pkg.fulfillmentMethod.code,
          toMethod: "PER_PACKAGE_DELIVERY",
          stopId: created.id,
        },
      },
      tx,
    );
    return created;
  });

  return stop;
}

/** Printed-fallback delivery — staff marks a stop without the magic link. */
export async function markStopDeliveredFromPrint(input: {
  seasonId: string;
  routeId: string;
  stopId: string;
  actorId?: string | null;
}) {
  const route = await getRouteDetail(input.seasonId, input.routeId);
  if (!route) throw new ApiError("Route not found", 404);
  if (!route.printPayload) {
    throw new ApiError("Print the route before using printed fallback", 409);
  }
  const stop = route.stops.find((s) => s.id === input.stopId);
  if (!stop) throw new ApiError("Stop not on this route", 404);
  if (stop.status === RouteStopStatus.DELIVERED) {
    return { stop, completed: route.status === DeliveryRouteStatus.COMPLETED };
  }

  return db.$transaction(async (tx) => {
    const updatedStop = await tx.routeStop.update({
      where: { id: stop.id },
      data: { status: RouteStopStatus.DELIVERED, deliveredAt: new Date() },
    });
    await tx.package.update({
      where: { id: stop.packageId },
      data: { stage: PackageStage.SENT, version: { increment: 1 } },
    });
    await writeAudit(
      {
        action: AuditAction.DRIVER_DELIVERED,
        actorId: input.actorId,
        meta: {
          routeId: route.id,
          stopId: stop.id,
          packageId: stop.packageId,
          via: "printed_fallback",
          at: new Date().toISOString(),
        },
      },
      tx,
    );

    const pending = await tx.routeStop.count({
      where: { routeId: route.id, status: RouteStopStatus.PENDING },
    });
    let completed = false;
    if (pending === 0) {
      const graceExpiresAt = new Date(Date.now() + GRACE_MS);
      await tx.deliveryRoute.update({
        where: { id: route.id },
        data: {
          status: DeliveryRouteStatus.COMPLETED,
          completedAt: new Date(),
          graceExpiresAt,
        },
      });
      await tx.driverMagicLink.updateMany({
        where: { routeId: route.id, revokedAt: null },
        data: { completedAt: new Date(), graceExpiresAt },
      });
      await writeAudit(
        {
          action: AuditAction.ROUTE_COMPLETED,
          actorId: input.actorId,
          meta: { routeId: route.id, via: "printed_fallback" },
        },
        tx,
      );
      completed = true;
    }
    return { stop: updatedStop, completed };
  });
}
