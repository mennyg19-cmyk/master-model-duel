import { prisma } from "@/lib/db";
import { AuditContextLike, recordAudit } from "@/lib/audit";
import { geocodeAddress } from "@/lib/customers/geocode";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { destinationSnapshotFor } from "@/lib/packages/destination";
import { reprintBatch } from "@/lib/packages/print-batches";
import { PackageEventAction } from "@/lib/packages/stages";
import { normalizedAddressKey } from "@/lib/routes/geo";
import { writeRouteEvent } from "@/lib/routes/events";
import { flipPackageChannelTx, preservedChargeCents, switchableInclude } from "@/lib/routes/switch";
import { voidLabel } from "@/lib/shipping/labels";

// UR-004/G-023/G-027: the map reroute. A nearby SHIPPED package (see
// nearbyShippedSuggestions) joins the route's run — ALWAYS behind an explicit
// manager confirm. The printed-not-shipped Shippo label voids through the P8
// path first, the channel flips to delivery with the charge preserved, the
// stop appends to the route, and the order's print batch re-files.

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
    include: { stops: { select: { seq: true } } },
  });
  if (!route) throw new NotFoundError("DeliveryRoute", input.routeId);
  if (route.status !== "PLANNED") {
    throw new DomainRuleError(
      `Route "${route.name}" is ${route.status}; reroute only adds to a PLANNED route — the driver already has a started run's manifest`,
    );
  }

  const pkg = await prisma.package.findUnique({ where: { id: input.packageId }, include: switchableInclude });
  if (!pkg) throw new NotFoundError("Package", input.packageId);
  if (pkg.order.season.status !== "OPEN") throw new NotFoundError("Package in the open season", input.packageId);
  if (pkg.channel !== "SHIPPED") {
    throw new DomainRuleError(`Package ${pkg.id} ships via ${pkg.channel}; reroute pulls SHIPPED packages onto a delivery route`);
  }
  if (pkg.stage === "SENT") {
    throw new DomainRuleError(`Package ${pkg.id} is SENT — the carrier already has it; reroute is impossible (G-023)`);
  }
  const activeStop = pkg.routeStops.find((stop) => stop.route.status === "PLANNED" || stop.route.status === "STARTED");
  if (activeStop) {
    throw new DomainRuleError(`Package ${pkg.id} is already on route "${activeStop.route.name}"; expected an unrouted package to reroute`);
  }
  const stuck = pkg.shipments.find((shipment) => shipment.status === "PURCHASING");
  if (stuck) {
    throw new DomainRuleError(
      `Package ${pkg.id} has a label purchase stuck mid-flight; force-resolve it on the package page before rerouting`,
    );
  }

  const purchased = pkg.shipments.find((shipment) => shipment.status === "PURCHASED");
  let voidedShipmentId: string | null = null;
  if (purchased) {
    const voided = await voidLabel({
      packageId: pkg.id,
      ctx: input.ctx,
      reason: `reroute onto delivery route "${route.name}" (G-023)`,
    });
    voidedShipmentId = voided.id;
  }

  const deliveryDay = route.deliveryDay ?? pkg.deliveryDay;
  if (!deliveryDay) {
    throw new DomainRuleError(
      `Route "${route.name}" has no delivery day and package ${pkg.id} carries none; set the route's day before rerouting`,
    );
  }
  const destination = destinationSnapshotFor(pkg);
  const point = await geocodeAddress(normalizedAddressKey(destination));
  const nextSeq = route.stops.reduce((max, stop) => Math.max(max, stop.seq), 0) + 1;
  const preservedFeeCents = preservedChargeCents(pkg);

  await prisma.$transaction(async (tx) => {
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
  });
  await recordAudit({
    ctx: input.ctx,
    action: "route_reroute",
    targetType: "DeliveryRoute",
    targetId: route.id,
    metadata: { packageId: pkg.id, stopSeq: nextSeq, voidedShipmentId, preservedFeeCents },
  });

  // "Updates print batch" (plan): the order's printed artifacts re-file under
  // PER_PACKAGE_DELIVERY so the warehouse never packs from a stale slip.
  await reprintBatch({ orderId: pkg.order.id, createdById: input.ctx.staff.id }).catch((error: unknown) => {
    if (error instanceof NotFoundError) return;
    throw error;
  });

  return { routeId: route.id, packageId: pkg.id, stopSeq: nextSeq, voidedShipmentId, preservedFeeCents };
}
