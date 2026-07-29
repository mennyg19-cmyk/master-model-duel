import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AuditContextLike, recordAudit } from "@/lib/audit";
import { geocodeAddress } from "@/lib/customers/geocode";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { destinationSnapshotFor } from "@/lib/packages/destination";
import { methodCodeForChoice } from "@/lib/packages/materialize";
import { reprintBestEffort } from "@/lib/packages/print-batches";
import { PackageEventAction } from "@/lib/packages/stages";
import {
  GeoPoint,
  haversineMiles,
  normalizedAddressKey,
  oneLineAddress,
  REROUTE_SUGGESTION_RADIUS_MILES,
  streetKey,
} from "@/lib/routes/geo";
import { writeRouteEvent } from "@/lib/routes/events";
import {
  assertNoStuckPurchase,
  assertOffActiveRoute,
  flipPackageChannelTx,
  preservedChargeCents,
  switchableInclude,
} from "@/lib/routes/switch";
import {
  CarrierRefund,
  LabelVoidError,
  markLabelVoidedTx,
  persistVoidRefundMarker,
  requestLabelVoid,
  usableStoredRefund,
  voidCrashMessage,
} from "@/lib/shipping/labels";

// UR-004/G-023/G-027: the map reroute — read model (candidate scan) and write
// model (manager-confirmed accept) live together (m13). A nearby SHIPPED
// package joins the route's run — ALWAYS behind an explicit manager confirm.
// The printed-not-shipped Shippo label voids through the P8 seam, the channel
// flips to delivery with the charge preserved, the stop appends to the route,
// and the order's print batch re-files.
//
// B1 atomic shape: the carrier void is the only irreversible call and can
// never join a local transaction, so it happens FIRST (after every guard —
// a refused reroute never voids). Every local write (void marking + channel
// flip + stop create + events + audit) then commits in ONE transaction, so
// no crash window leaves "label voided, package still SHIPPED".

const ACTIVE_ROUTE_STATUSES = ["PLANNED", "STARTED"] as const;

const candidateInclude = {
  recipientAddress: true,
  lines: { include: { orderLine: { include: { recipient: true } } } },
} satisfies Prisma.PackageInclude;

type RerouteCandidatePackage = Prisma.PackageGetPayload<{ include: typeof candidateInclude }>;

interface StopGeo {
  seq: number;
  addressLine1: string;
  postalCode: string;
  lat: number | null;
  lng: number | null;
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

function nearestStopDistance(point: GeoPoint, stops: StopGeo[]): { stopSeq: number; distance: number } | null {
  let best: { stopSeq: number; distance: number } | null = null;
  for (const stop of stops) {
    if (stop.lat === null || stop.lng === null) continue;
    const distance = haversineMiles(point, { lat: stop.lat, lng: stop.lng });
    if (!best || distance < best.distance) best = { stopSeq: stop.seq, distance };
  }
  return best;
}

// The G-023 "nearby" law, spelled once: a stop on the destination's street
// (no geocode needed) or a stop within REROUTE_SUGGESTION_RADIUS_MILES. Both
// the suggestion scan AND the manager-confirmed accept enforce it (m1).
function matchRerouteLaw(
  destination: { line1: string },
  point: GeoPoint | null,
  stops: StopGeo[],
): { matchedStopSeq: number; distanceMiles: number | null; reason: "nearby" | "same-street" } | null {
  const streetStop = stops.find((stop) => streetKey(stop.addressLine1) === streetKey(destination.line1));
  if (streetStop) {
    return { matchedStopSeq: streetStop.seq, distanceMiles: null, reason: "same-street" };
  }
  if (!point) return null;
  const best = nearestStopDistance(point, stops);
  if (best && best.distance <= REROUTE_SUGGESTION_RADIUS_MILES) {
    return { matchedStopSeq: best.stopSeq, distanceMiles: Math.round(best.distance * 100) / 100, reason: "nearby" };
  }
  return null;
}

// G-023/G-027: unshipped SHIPPED packages that belong on this route's run.
// The manager always confirms; nothing here mutates. Bounded scan (M5):
// same-street matches short-circuit BEFORE any geocode, and the radius law
// can only hold within a stop's postal code (local delivery: a 0.5-mile
// radius never crosses a postal boundary), so only postal-matching candidates
// pay a geocode.
export async function nearbyShippedSuggestions(routeId: string): Promise<RerouteSuggestion[]> {
  const route = await prisma.deliveryRoute.findUnique({
    where: { id: routeId },
    include: { stops: { orderBy: { seq: "asc" } } },
  });
  if (!route) throw new NotFoundError("DeliveryRoute", routeId);
  if (route.stops.length === 0) return [];

  // m12: the shipped method's terminal stage resolves dynamically — a rename
  // can never silently make terminal packages reroute-eligible.
  const shippedMethod = await prisma.fulfillmentMethod.findFirst({
    where: { code: methodCodeForChoice("SHIPPED"), active: true },
    select: { terminalStage: true },
  });
  if (!shippedMethod) return [];

  const candidates: RerouteCandidatePackage[] = await prisma.package.findMany({
    where: {
      order: { seasonId: route.seasonId },
      channel: "SHIPPED",
      stage: { not: shippedMethod.terminalStage },
      routeStops: { none: { route: { status: { in: [...ACTIVE_ROUTE_STATUSES] } } } },
    },
    include: candidateInclude,
    orderBy: { id: "asc" },
  });

  const stopPostalCodes = new Set(route.stops.map((stop) => stop.postalCode));
  const suggestions: RerouteSuggestion[] = [];
  for (const pkg of candidates) {
    const destination = destinationSnapshotFor(pkg);
    // Pre-filter 1: same-street needs no geocode at all.
    const streetMatch = matchRerouteLaw(destination, null, route.stops);
    if (streetMatch) {
      suggestions.push({
        packageId: pkg.id,
        recipientName: pkg.recipientName,
        address: oneLineAddress(destination),
        stage: pkg.stage,
        distanceMiles: null,
        matchedStopSeq: streetMatch.matchedStopSeq,
        reason: streetMatch.reason,
      });
      continue;
    }
    // Pre-filter 2: only a postal-matching candidate can satisfy the radius.
    if (!stopPostalCodes.has(destination.postalCode)) continue;
    const point = await geocodeAddress(normalizedAddressKey(destination));
    const match = matchRerouteLaw(destination, point, route.stops);
    if (!match) continue;
    suggestions.push({
      packageId: pkg.id,
      recipientName: pkg.recipientName,
      address: oneLineAddress(destination),
      stage: pkg.stage,
      distanceMiles: match.distanceMiles,
      matchedStopSeq: match.matchedStopSeq,
      reason: match.reason,
    });
  }
  return suggestions;
}

export interface RerouteResult {
  routeId: string;
  packageId: string;
  stopSeq: number;
  voidedShipmentId: string | null;
  preservedFeeCents: number;
}

export async function confirmRouteReroute(input: {
  routeId: string;
  packageId: string;
  confirm: boolean;
  ctx: AuditContextLike;
}): Promise<RerouteResult> {
  if (!input.confirm) {
    throw new DomainRuleError("Reroute requires the manager's explicit confirm (G-027); pass confirm: true");
  }
  const route = await prisma.deliveryRoute.findUnique({
    where: { id: input.routeId },
    include: { season: { select: { status: true } }, stops: { orderBy: { seq: "asc" } } },
  });
  if (!route) throw new NotFoundError("DeliveryRoute", input.routeId);
  // m4: the route side scopes to the open season too — a stale PLANNED route
  // from a prior season can never accept an open-season package.
  if (route.season.status !== "OPEN") {
    throw new DomainRuleError(`Route "${route.name}" belongs to a closed season; expected an open-season route to reroute`);
  }
  if (route.status !== "PLANNED") {
    throw new DomainRuleError(
      `Route "${route.name}" is ${route.status}; reroute only adds to a PLANNED route — the driver already has a started run's manifest`,
    );
  }

  const pkg = await prisma.package.findUnique({ where: { id: input.packageId }, include: switchableInclude });
  if (!pkg) throw new NotFoundError("Package", input.packageId);
  // M6: closed season is a domain rule (409), not a missing package (404).
  if (pkg.order.season.status !== "OPEN") {
    throw new DomainRuleError(
      `Package ${pkg.id} belongs to a closed season; expected an open-season package to reroute`,
    );
  }
  if (pkg.order.seasonId !== route.seasonId) {
    throw new DomainRuleError(
      `Package ${pkg.id} and route "${route.name}" belong to different seasons; expected both in the open season (m4)`,
    );
  }
  if (pkg.channel !== "SHIPPED") {
    throw new DomainRuleError(`Package ${pkg.id} ships via ${pkg.channel}; reroute pulls SHIPPED packages onto a delivery route`);
  }
  // m12: terminal resolves from the method, not a hardcoded "SENT".
  if (pkg.stage === pkg.fulfillmentMethod.terminalStage) {
    throw new DomainRuleError(`Package ${pkg.id} is ${pkg.stage} — the carrier already has it; reroute is impossible (G-023)`);
  }
  assertOffActiveRoute(pkg, "rerouting");
  assertNoStuckPurchase(pkg, "rerouting");

  const deliveryDay = route.deliveryDay ?? pkg.deliveryDay;
  if (!deliveryDay) {
    throw new DomainRuleError(
      `Route "${route.name}" has no delivery day and package ${pkg.id} carries none; set the route's day before rerouting`,
    );
  }
  const destination = destinationSnapshotFor(pkg);
  const point = await geocodeAddress(normalizedAddressKey(destination));
  // m1: the confirm path re-verifies the G-023 geography law — a stale
  // suggestion list can never silently pull a far-away package onto the run.
  if (!matchRerouteLaw(destination, point, route.stops)) {
    throw new DomainRuleError(
      `Package ${pkg.id} is not within ${REROUTE_SUGGESTION_RADIUS_MILES} mi of a stop or on a stop's street (G-023); the suggestion list may be stale — rescan before confirming`,
    );
  }
  const nextSeq = route.stops.reduce((max, stop) => Math.max(max, stop.seq), 0) + 1;
  const preservedFeeCents = preservedChargeCents(pkg);

  // B1: every guard passed — only now does the irreversible carrier call run.
  // A PURCHASED row already carrying a shippoRefundId means the carrier void
  // succeeded on an earlier crashed attempt: skip the carrier call and
  // complete locally from the stored refund id.
  const purchased = pkg.shipments.find((shipment) => shipment.status === "PURCHASED");
  let refund: CarrierRefund | null = null;
  if (purchased) {
    const storedRefund = usableStoredRefund(purchased);
    if (!purchased.shippoTransactionId && !storedRefund) {
      throw new LabelVoidError("the purchased label is missing its carrier transaction id");
    }
    refund = storedRefund ?? (await requestLabelVoid(purchased.shippoTransactionId!));
  }

  let voidedShipmentId: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      if (purchased && refund) {
        const voided = await markLabelVoidedTx(tx, {
          active: purchased,
          refund,
          packageId: pkg.id,
          actorId: input.ctx.staff.id,
          reason: `reroute onto delivery route "${route.name}" (G-023)`,
          ctx: input.ctx,
        });
        voidedShipmentId = voided.id;
      }
      await flipPackageChannelTx(tx, pkg, "PER_PACKAGE_DELIVERY", deliveryDay);
      const stop = await tx.routeStop.create({
        data: {
          routeId: route.id,
          seq: nextSeq,
          packageId: pkg.id,
          recipientName: pkg.recipientName,
          addressLine1: destination.line1,
          addressLine2: destination.line2,
          city: destination.city,
          region: destination.region,
          postalCode: destination.postalCode,
          lat: point.lat,
          lng: point.lng,
        },
      });
      const rerouteAction: PackageEventAction = "reroute";
      await tx.packageEvent.create({
        data: {
          packageId: pkg.id,
          action: rerouteAction,
          actorId: input.ctx.staff.id,
          metadata: { routeId: route.id, routeName: route.name, stopId: stop.id, voidedShipmentId, preservedFeeCents },
        },
      });
      await writeRouteEvent(tx, route.id, "stop_added_reroute", {
        stopId: stop.id,
        actorId: input.ctx.staff.id,
        metadata: { packageId: pkg.id, fromChannel: "SHIPPED", voidedShipmentId },
      });
      await recordAudit(
        {
          ctx: input.ctx,
          action: "route_reroute",
          targetType: "DeliveryRoute",
          targetId: route.id,
          metadata: { packageId: pkg.id, stopSeq: nextSeq, voidedShipmentId, preservedFeeCents },
        },
        tx,
      );
    });
  } catch (persistError) {
    // The carrier void succeeded but the local void+flip failed — mark the
    // refund id on the row so a retry resumes WITHOUT a second carrier call
    // and the shipping sweep can reconcile even without one (B1).
    if (purchased && refund) {
      const detail = persistError instanceof Error ? persistError.message : String(persistError);
      await persistVoidRefundMarker(purchased, refund, detail);
      throw new LabelVoidError(voidCrashMessage(refund, detail));
    }
    throw persistError;
  }

  // "Updates print batch" (plan): the order's printed artifacts re-file under
  // PER_PACKAGE_DELIVERY so the warehouse never packs from a stale slip.
  await reprintBestEffort(pkg.order.id, input.ctx.staff.id);

  return { routeId: route.id, packageId: pkg.id, stopSeq: nextSeq, voidedShipmentId, preservedFeeCents };
}
