import { DeliveryRoute, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AuditContextLike, recordAudit } from "@/lib/audit";
import { geocodeAddress } from "@/lib/customers/geocode";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { destinationSnapshotFor } from "@/lib/packages/destination";
import { loadTerminalStages } from "@/lib/packages/stages";
import { GeoPoint, haversineMiles, normalizedAddressKey, oneLineAddress, streetKey } from "@/lib/routes/geo";
import { orderStops } from "@/lib/routes/optimize";
import { writeRouteEvent } from "@/lib/routes/events";
import { getOpenSeason } from "@/lib/seasons/queries";
import { getSetting } from "@/lib/settings";

// R-074/R-075: the route builder. Turns a delivery day's eligible packages
// into a seq-ordered, geocoded route. "Eligible" is exact: open season,
// PER_PACKAGE_DELIVERY, non-terminal, not already sitting on an active
// (PLANNED/STARTED) route — a package can never be on two manifests.

export const REROUTE_SUGGESTION_RADIUS_MILES = 0.5;

const packageForRoutingInclude = {
  recipientAddress: true,
  lines: { include: { orderLine: { include: { recipient: true } } } },
} satisfies Prisma.PackageInclude;

export type RoutablePackage = Prisma.PackageGetPayload<{ include: typeof packageForRoutingInclude }>;

const ACTIVE_ROUTE_STATUSES = ["PLANNED", "STARTED"] as const;

async function loadOrigin(): Promise<GeoPoint> {
  const origin = await getSetting("shipping.origin");
  if (!origin) {
    throw new DomainRuleError("shipping.origin is not configured; expected the org address to geocode routes from");
  }
  return geocodeAddress(normalizedAddressKey(origin));
}

export interface BuildRouteResult {
  routeId: string;
  name: string;
  stopCount: number;
  provider: "mapbox" | "nearest-neighbor";
}

export async function buildRoute(input: {
  deliveryDay: string;
  name?: string;
  ctx: AuditContextLike;
}): Promise<BuildRouteResult> {
  const season = await getOpenSeason();
  if (!season) throw new DomainRuleError("No open season — routes only build from the open season's packages");
  const days = (await getSetting("delivery.days")) ?? [];
  if (!days.includes(input.deliveryDay)) {
    throw new DomainRuleError(
      `Delivery day "${input.deliveryDay}" is not one of the manager-set days (${days.join(", ") || "none configured"})`,
    );
  }
  const terminalStages = await loadTerminalStages();

  const eligible: RoutablePackage[] = await prisma.package.findMany({
    where: {
      order: { seasonId: season.id },
      channel: "PER_PACKAGE_DELIVERY",
      deliveryDay: input.deliveryDay,
      stage: { notIn: terminalStages },
      routeStops: { none: { route: { status: { in: [...ACTIVE_ROUTE_STATUSES] } } } },
    },
    include: packageForRoutingInclude,
    orderBy: { id: "asc" },
  });
  if (eligible.length === 0) {
    throw new DomainRuleError(
      `No eligible per-package-delivery packages for ${input.deliveryDay}; expected non-terminal, unrouted packages to build a route`,
    );
  }

  // Geocode every destination through the P4 cache (R-074/R-179) — repeat
  // builds of the same addresses never refetch.
  const stops = await Promise.all(
    eligible.map(async (pkg) => {
      const destination = destinationSnapshotFor(pkg);
      const point = await geocodeAddress(normalizedAddressKey(destination));
      return { pkg, destination, point };
    }),
  );
  const origin = await loadOrigin();
  const optimized = await orderStops(origin, stops.map((stop) => stop.point));

  const routeCount = await prisma.deliveryRoute.count({
    where: { seasonId: season.id, deliveryDay: input.deliveryDay },
  });
  const name = input.name?.trim() || `${input.deliveryDay} — Route ${routeCount + 1}`;

  const route = await prisma.$transaction(async (tx) => {
    const created = await tx.deliveryRoute.create({
      data: {
        seasonId: season.id,
        name,
        deliveryDay: input.deliveryDay,
        createdById: input.ctx.staff.id,
      },
    });
    await tx.routeStop.createMany({
      data: optimized.order.map((stopIndex, position) => {
        const stop = stops[stopIndex];
        return {
          routeId: created.id,
          seq: position + 1,
          packageId: stop.pkg.id,
          recipientName: stop.pkg.recipientName,
          addressLine1: stop.destination.line1,
          addressLine2: stop.destination.line2,
          city: stop.destination.city,
          region: stop.destination.region,
          postalCode: stop.destination.postalCode,
          lat: stop.point.lat,
          lng: stop.point.lng,
        };
      }),
    });
    await writeRouteEvent(tx, created.id, "route_created", {
      actorId: input.ctx.staff.id,
      metadata: {
        deliveryDay: input.deliveryDay,
        stopCount: optimized.order.length,
        optimizer: optimized.provider,
      },
    });
    return created;
  });

  await recordAudit({
    ctx: input.ctx,
    action: "route_create",
    targetType: "DeliveryRoute",
    targetId: route.id,
    metadata: { name, deliveryDay: input.deliveryDay, stopCount: optimized.order.length, optimizer: optimized.provider },
  });
  return { routeId: route.id, name, stopCount: optimized.order.length, provider: optimized.provider };
}

export async function listRoutes(seasonId: string): Promise<
  (DeliveryRoute & { stopCount: number; deliveredCount: number; hasLink: boolean })[]
> {
  const routes = await prisma.deliveryRoute.findMany({
    where: { seasonId },
    include: { stops: { select: { deliveredAt: true } }, link: { select: { id: true } } },
    orderBy: { createdAt: "desc" },
  });
  return routes.map((route) => ({
    ...route,
    stopCount: route.stops.length,
    deliveredCount: route.stops.filter((stop) => stop.deliveredAt !== null).length,
    hasLink: route.link !== null,
  }));
}

export async function loadRouteDetail(routeId: string) {
  const route = await prisma.deliveryRoute.findUnique({
    where: { id: routeId },
    include: {
      stops: {
        orderBy: { seq: "asc" },
        include: {
          package: {
            select: {
              id: true,
              stage: true,
              greeting: true,
              order: { select: { id: true, wireFormat: true, orderNumber: true, customer: { select: { name: true } } } },
            },
          },
        },
      },
      // The token hash never leaves the DB — staff see existence + expiry only.
      link: { select: { id: true, expiresAt: true, pinHash: true, createdAt: true } },
      events: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!route) throw new NotFoundError("DeliveryRoute", routeId);
  return route;
}

export async function reassignStop(input: {
  routeId: string;
  stopId: string;
  toRouteId: string;
  ctx: AuditContextLike;
}): Promise<void> {
  if (input.routeId === input.toRouteId) {
    throw new DomainRuleError("Reassign needs a different target route; source and target are the same route");
  }
  await prisma.$transaction(async (tx) => {
    const [source, target] = await Promise.all([
      tx.deliveryRoute.findUnique({ where: { id: input.routeId }, include: { stops: true } }),
      tx.deliveryRoute.findUnique({ where: { id: input.toRouteId }, include: { stops: true } }),
    ]);
    if (!source) throw new NotFoundError("DeliveryRoute", input.routeId);
    if (!target) throw new NotFoundError("DeliveryRoute", input.toRouteId);
    if (source.status !== "PLANNED" || target.status !== "PLANNED") {
      throw new DomainRuleError(
        `Reassign only moves stops between PLANNED routes (source ${source.status}, target ${target.status}); a started route's manifest is fixed`,
      );
    }
    const stop = source.stops.find((candidate) => candidate.id === input.stopId);
    if (!stop) throw new NotFoundError("RouteStop", input.stopId);

    const nextSeq = target.stops.reduce((max, candidate) => Math.max(max, candidate.seq), 0) + 1;
    await tx.routeStop.delete({ where: { id: stop.id } });
    const moved = await tx.routeStop.create({
      data: {
        routeId: target.id,
        seq: nextSeq,
        packageId: stop.packageId,
        recipientName: stop.recipientName,
        addressLine1: stop.addressLine1,
        addressLine2: stop.addressLine2,
        city: stop.city,
        region: stop.region,
        postalCode: stop.postalCode,
        lat: stop.lat,
        lng: stop.lng,
      },
    });
    await writeRouteEvent(tx, source.id, "stop_reassigned_out", {
      stopId: stop.id,
      actorId: input.ctx.staff.id,
      metadata: { toRouteId: target.id, packageId: stop.packageId },
    });
    await writeRouteEvent(tx, target.id, "stop_reassigned_in", {
      stopId: moved.id,
      actorId: input.ctx.staff.id,
      metadata: { fromRouteId: source.id, packageId: stop.packageId },
    });
  });
  await recordAudit({
    ctx: input.ctx,
    action: "route_reassign",
    targetType: "DeliveryRoute",
    targetId: input.routeId,
    metadata: { stopId: input.stopId, toRouteId: input.toRouteId },
  });
}

export interface RerouteSuggestion {
  packageId: string;
  recipientName: string;
  address: string;
  stage: string;
  distanceMiles: number | null;
  matchedStopSeq: number;
  reason: "nearby" | "same-street";
}

// G-023/G-027: unshipped SHIPPED packages that belong on this route's run —
// within REROUTE_SUGGESTION_RADIUS_MILES of a stop, or on a stop's street.
// The manager always confirms; nothing here mutates.
export async function nearbyShippedSuggestions(routeId: string): Promise<RerouteSuggestion[]> {
  const route = await prisma.deliveryRoute.findUnique({
    where: { id: routeId },
    include: { stops: { orderBy: { seq: "asc" } } },
  });
  if (!route) throw new NotFoundError("DeliveryRoute", routeId);
  if (route.stops.length === 0) return [];

  const candidates: RoutablePackage[] = await prisma.package.findMany({
    where: {
      order: { seasonId: route.seasonId },
      channel: "SHIPPED",
      stage: { not: "SENT" },
      routeStops: { none: { route: { status: { in: [...ACTIVE_ROUTE_STATUSES] } } } },
    },
    include: packageForRoutingInclude,
    orderBy: { id: "asc" },
  });

  const suggestions: RerouteSuggestion[] = [];
  for (const pkg of candidates) {
    const destination = destinationSnapshotFor(pkg);
    const point = await geocodeAddress(normalizedAddressKey(destination));
    let best: { stopSeq: number; distance: number } | null = null;
    for (const stop of route.stops) {
      if (stop.lat === null || stop.lng === null) continue;
      const distance = haversineMiles(point, { lat: stop.lat, lng: stop.lng });
      if (!best || distance < best.distance) best = { stopSeq: stop.seq, distance };
    }
    if (best && best.distance <= REROUTE_SUGGESTION_RADIUS_MILES) {
      suggestions.push({
        packageId: pkg.id,
        recipientName: pkg.recipientName,
        address: oneLineAddress(destination),
        stage: pkg.stage,
        distanceMiles: Math.round(best.distance * 100) / 100,
        matchedStopSeq: best.stopSeq,
        reason: "nearby",
      });
      continue;
    }
    const streetStop = route.stops.find((stop) => streetKey(stop.addressLine1) === streetKey(destination.line1));
    if (streetStop) {
      suggestions.push({
        packageId: pkg.id,
        recipientName: pkg.recipientName,
        address: oneLineAddress(destination),
        stage: pkg.stage,
        distanceMiles: best ? Math.round(best.distance * 100) / 100 : null,
        matchedStopSeq: streetStop.seq,
        reason: "same-street",
      });
    }
  }
  return suggestions;
}
