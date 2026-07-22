import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { geocodeAddress, WAREHOUSE_ORIGIN } from "@/lib/addresses/geocode";
import { getSetting } from "@/lib/settings";
import { ActionError } from "@/lib/packages/actions";
import { canVoidShipment } from "@/lib/shipping/labels";
import { voidLabel } from "@/lib/shipping/shippo";
import { notifyCustomer } from "@/lib/notifications";
import { distanceMiles, nearestNeighborOrder, sameStreet, type LatLng } from "@/lib/routes/geo";
import { LINK_COMPLETION_GRACE_MINUTES } from "@/lib/routes/links";

// Delivery route lifecycle (R-074..R-078, UR-002, UR-004, G-023, G-027).

const REROUTE_RADIUS_MILES = 0.5;

const DELIVERY_KINDS = ["BULK_DELIVERY", "PER_PACKAGE_DELIVERY"] as const;

type PackageAddress = { line1: string; line2?: string | null; city: string; state: string; zip: string };

function addressOf(pkg: { addressLine1: string; addressLine2: string | null; city: string; state: string; zip: string }): PackageAddress {
  return { line1: pkg.addressLine1, line2: pkg.addressLine2, city: pkg.city, state: pkg.state, zip: pkg.zip };
}

/** Distinct customers behind a package's order lines — the notification audience. */
async function packageCustomers(packageIds: string[], tx: Prisma.TransactionClient = db) {
  const lines = await tx.orderLine.findMany({
    where: { packageId: { in: packageIds } },
    select: { packageId: true, order: { select: { customer: { select: { id: true, email: true, name: true, phone: true } } } } },
  });
  const byPackage = new Map<string, Map<string, { id: string; email: string; name: string; phone: string | null }>>();
  for (const line of lines) {
    const customers = byPackage.get(line.packageId!) ?? new Map();
    customers.set(line.order.customer.id, line.order.customer);
    byPackage.set(line.packageId!, customers);
  }
  return byPackage;
}

/**
 * Build a route from unassigned, undelivered packages of one delivery method
 * (R-074): geocode every destination through the cache, then order stops
 * nearest-neighbor from the warehouse origin.
 */
export async function buildRoute(
  seasonId: string,
  input: { methodId: string; name?: string; maxStops?: number },
  staffId?: string
) {
  const method = await db.fulfillmentMethod.findUnique({ where: { id: input.methodId } });
  if (!method || !(DELIVERY_KINDS as readonly string[]).includes(method.kind)) {
    throw new ActionError("Routes are built from delivery packages — pick a delivery method", 400);
  }

  const candidates = await db.package.findMany({
    where: {
      seasonId,
      fulfillmentMethodId: method.id,
      stage: { notIn: ["SENT", "PICKED_UP"] },
      routeStop: null,
      lines: { some: {} },
    },
    orderBy: { createdAt: "asc" },
    take: input.maxStops && input.maxStops > 0 ? input.maxStops : undefined,
  });
  if (candidates.length === 0) {
    throw new ActionError("No unassigned packages for that method — every delivery is already on a route", 409);
  }

  const origin = await getSetting("shipping.origin");
  const originCoordinates = (await geocodeAddress(origin)) ?? WAREHOUSE_ORIGIN;

  const withCoordinates = [];
  for (const pkg of candidates) {
    const coordinates = await geocodeAddress(addressOf(pkg));
    withCoordinates.push({ pkg, coordinates });
  }
  const ordered = nearestNeighborOrder(originCoordinates, withCoordinates);

  const routeCount = await db.deliveryRoute.count({ where: { seasonId } });
  const route = await db.$transaction(async (tx) => {
    // Re-assert availability inside the transaction: a concurrent build may
    // have grabbed some of these packages since the candidate query ran.
    const taken = await tx.routeStop.count({
      where: { packageId: { in: ordered.map((entry) => entry.pkg.id) } },
    });
    if (taken > 0) {
      throw new ActionError("Some of those packages just landed on another route — rebuild", 409);
    }
    const created = await tx.deliveryRoute.create({
      data: {
        seasonId,
        name: input.name?.trim() || `Route ${routeCount + 1} — ${method.name}`,
        createdByStaffId: staffId,
      },
    });
    for (let i = 0; i < ordered.length; i++) {
      await tx.routeStop.create({
        data: {
          routeId: created.id,
          packageId: ordered[i].pkg.id,
          position: i + 1,
          latitude: ordered[i].coordinates?.latitude,
          longitude: ordered[i].coordinates?.longitude,
        },
      });
    }
    return created;
  });
  return { route, stopCount: ordered.length };
}

async function loadRoute(seasonId: string, routeId: string) {
  const route = await db.deliveryRoute.findFirst({ where: { id: routeId, seasonId } });
  if (!route) throw new ActionError("Route not found", 404);
  return route;
}

/**
 * Start the route (G-027): flips to IN_PROGRESS and captures the day-of
 * delivery notification for every per-package-delivery stop. Dedupe keys make
 * a second start (or a retry) a no-op — exactly one notification per
 * package/customer/channel.
 */
export async function startRoute(seasonId: string, routeId: string, actor: string) {
  const route = await loadRoute(seasonId, routeId);
  if (route.status === "COMPLETED") throw new ActionError("This route is already completed");
  if (route.status === "PLANNED") {
    await db.deliveryRoute.update({
      where: { id: route.id },
      data: { status: "IN_PROGRESS", startedAt: new Date() },
    });
  }
  const notified = await captureDayOfNotifications(route.id, route.name);
  await db.auditLog.create({
    data: {
      actorEmail: actor,
      action: "route.started",
      targetType: "DeliveryRoute",
      targetId: route.id,
      detail: { notificationsCaptured: notified },
    },
  });
  return { notified };
}

async function captureDayOfNotifications(routeId: string, routeName: string): Promise<number> {
  // Every route stop is a delivery package (buildRoute only accepts delivery
  // methods) — bulk-delivery customers get the same day-of heads-up as
  // per-package ones.
  const stops = await db.routeStop.findMany({
    where: { routeId, deliveredAt: null },
    include: { package: true },
  });
  if (stops.length === 0) return 0;
  const audiences = await packageCustomers(stops.map((stop) => stop.packageId));
  let captured = 0;
  for (const stop of stops) {
    for (const customer of audiences.get(stop.packageId)?.values() ?? []) {
      captured += await notifyCustomer(customer, {
        kind: "day_of_delivery",
        subject: "Your Mishloach Manos is out for delivery today",
        body: `Good news, ${customer.name}: the package for ${stop.package.recipientName} (${stop.package.addressLine1}, ${stop.package.city}) is on today's delivery route (${routeName}).`,
        smsBody: `${customer.name}: ${stop.package.recipientName}'s package is on route ${routeName} today.`,
        dedupeKey: `day-of|${routeId}|${stop.packageId}|${customer.id}`,
        packageId: stop.packageId,
      });
    }
  }
  return captured;
}

export type DeliveredBy = { kind: "link"; linkId: string } | { kind: "staff"; staffId: string; staffEmail: string };

/**
 * Mark one stop delivered — the driver's tap (magic link) or the printed
 * fallback (staff on route detail). Audited with timestamp + link id
 * (UR-015); the package advances to SENT; delivering the last stop completes
 * the route and puts every live link on the expiry clock.
 */
export async function markStopDelivered(seasonId: string, routeId: string, stopId: string, by: DeliveredBy) {
  const outcome = await db.$transaction(async (tx) => {
    const stop = await tx.routeStop.findFirst({
      where: { id: stopId, routeId, route: { seasonId } },
      include: { package: { include: { fulfillmentMethod: { select: { kind: true } } } } },
    });
    if (!stop) throw new ActionError("Stop not found on this route", 404);
    if (stop.deliveredAt) throw new ActionError("This stop is already marked delivered");

    const deliveredBy = by.kind === "link" ? `link:${by.linkId}` : `staff:${by.staffId}`;
    // Guarded flip: only one concurrent tap wins the deliveredAt: null row —
    // the loser refuses instead of double-writing audit + completion.
    const flipped = await tx.routeStop.updateMany({
      where: { id: stop.id, deliveredAt: null },
      data: { deliveredAt: new Date(), deliveredBy },
    });
    if (flipped.count === 0) throw new ActionError("This stop is already marked delivered");

    // The tap is the physical hand-off: the package reaches its terminal stage.
    if (stop.package.stage !== "SENT" && stop.package.stage !== "PICKED_UP") {
      await tx.package.update({
        where: { id: stop.packageId },
        data: { stage: "SENT", version: { increment: 1 } },
      });
    }
    await tx.packageAudit.create({
      data: {
        packageId: stop.packageId,
        actorStaffId: by.kind === "staff" ? by.staffId : null,
        action: "delivered",
        detail: { routeId, stopId: stop.id, via: deliveredBy },
      },
    });
    await tx.auditLog.create({
      data: {
        actorEmail: by.kind === "link" ? `route-link:${by.linkId}` : by.staffEmail,
        action: "route.stop.delivered",
        targetType: "Package",
        targetId: stop.packageId,
        detail: { routeId, stopId: stop.id, linkId: by.kind === "link" ? by.linkId : undefined },
      },
    });

    const remaining = await tx.routeStop.count({ where: { routeId, deliveredAt: null } });
    if (remaining === 0) {
      // Idempotent completion: a second observer of remaining === 0 finds the
      // route already COMPLETED and writes nothing.
      await tx.deliveryRoute.updateMany({
        where: { id: routeId, status: { not: "COMPLETED" } },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      // Link expiry on completion (G-025) with a short grace window.
      await tx.routeLink.updateMany({
        where: { routeId, revokedAt: null, expiresAt: null },
        data: { expiresAt: new Date(Date.now() + LINK_COMPLETION_GRACE_MINUTES * 60_000) },
      });
    }
    return { completed: remaining === 0 };
  });
  return outcome;
}

/**
 * Method switch (UR-002, G-005): shipping <-> delivery, both directions. The
 * money is deliberately untouched — the order's paid fee snapshot stays what
 * the customer owed (G-028); the audit records who switched what and when.
 * Switching a shipping package away voids its printed-but-unshipped label.
 *
 * Atomicity: the label void (DB flip + carrier call) and every switch write
 * commit in ONE transaction — same pattern as buyLabelForPackage. A carrier
 * refusal or any later failure rolls everything back: no voided label with
 * the package still on shipping. The optional `extend` callback runs inside
 * the same transaction so a caller (reroute) can make its stop creation
 * atomic with the switch.
 */
export async function switchPackageMethod<T = undefined>(
  seasonId: string,
  packageId: string,
  targetMethodId: string,
  staff: { id: string; email: string },
  extend?: (tx: Prisma.TransactionClient) => Promise<T>
) {
  const pkg = await db.package.findFirst({
    where: { id: packageId, seasonId },
    include: {
      fulfillmentMethod: true,
      shipments: {
        where: { status: "PURCHASED" },
        select: { id: true, shippoTransactionId: true, carrier: true, costCents: true },
      },
      routeStop: { select: { id: true, deliveredAt: true } },
    },
  });
  if (!pkg) throw new ActionError("Package not found", 404);
  if (!canVoidShipment(pkg.stage)) {
    throw new ActionError("This package already went out — its method can no longer change");
  }
  const target = await db.fulfillmentMethod.findUnique({ where: { id: targetMethodId } });
  if (!target || !target.isActive) throw new ActionError("Pick an active fulfillment method", 400);
  if (target.id === pkg.fulfillmentMethodId) throw new ActionError("The package already uses that method", 400);

  const kinds = new Set([pkg.fulfillmentMethod.kind, target.kind]);
  const shippingDelivery =
    kinds.has("SHIPPING") && (kinds.has("BULK_DELIVERY") || kinds.has("PER_PACKAGE_DELIVERY"));
  if (!shippingDelivery) {
    throw new ActionError("Method switch covers shipping \u2194 delivery — other moves go through the package board", 400);
  }
  if (pkg.routeStop && !pkg.routeStop.deliveredAt && target.kind === "SHIPPING") {
    throw new ActionError("This package sits on a delivery route — remove the stop before switching it to shipping");
  }

  const extra = await db.$transaction(
    async (tx) => {
      // Void the printed-not-shipped label INSIDE the switch transaction (P8
      // hook): the guarded flip refuses a concurrent void, the carrier call is
      // bounded by SHIPPO_TIMEOUT_MS, and a refusal rolls the whole switch
      // back — label, method, and (via extend) route stop move together.
      for (const shipment of pkg.shipments) {
        const flipped = await tx.shipment.updateMany({
          where: { id: shipment.id, status: "PURCHASED" },
          data: { status: "VOIDED", voidedAt: new Date(), voidedByStaffId: staff.id },
        });
        if (flipped.count === 0) throw new ActionError("Only an active label can be voided");
        if (shipment.shippoTransactionId) await voidLabel(shipment.shippoTransactionId);
        await tx.packageAudit.create({
          data: {
            packageId: pkg.id,
            actorStaffId: staff.id,
            action: "label_voided",
            detail: { shipmentId: shipment.id, carrier: shipment.carrier, costCents: shipment.costCents },
          },
        });
      }

      await tx.package.update({
        where: { id: pkg.id },
        data: {
          fulfillmentMethodId: target.id,
          // Retired suffix key: finalize must never merge new lines into a
          // package staff deliberately re-routed (same discipline as splits).
          groupingKey: `${pkg.groupingKey.split("#")[0]}#switched-${randomBytes(4).toString("hex")}`,
          version: { increment: 1 },
        },
      });
      await tx.orderLine.updateMany({
        where: { packageId: pkg.id },
        data: { fulfillmentMethodId: target.id },
      });
      const detail = {
        from: pkg.fulfillmentMethod.name,
        to: target.name,
        voidedShipmentIds: pkg.shipments.map((shipment) => shipment.id),
        chargePreserved: true,
      };
      await tx.packageAudit.create({
        data: { packageId: pkg.id, actorStaffId: staff.id, action: "method_switched", detail },
      });
      await tx.auditLog.create({
        data: {
          actorStaffId: staff.id,
          actorEmail: staff.email,
          action: "package.method_switched",
          targetType: "Package",
          targetId: pkg.id,
          detail,
        },
      });
      return extend ? extend(tx) : (undefined as T);
    },
    { maxWait: 10_000, timeout: 45_000 }
  );
  return { from: pkg.fulfillmentMethod, to: target, extra };
}

export type RerouteSuggestion = {
  packageId: string;
  recipientName: string;
  address: string;
  stage: string;
  distanceMiles: number | null;
  nearStopPosition: number;
  reason: "radius" | "same_street";
  hasActiveLabel: boolean;
};

/**
 * Map reroute suggestions (G-023): unshipped SHIPPING packages within ~0.5
 * mile of a stop, or on the same street as one. Suggestions only — adding to
 * the route always goes through the manager's explicit confirm.
 */
export async function rerouteSuggestions(seasonId: string, routeId: string): Promise<RerouteSuggestion[]> {
  const stops = await db.routeStop.findMany({
    where: { routeId, route: { seasonId } },
    include: { package: { select: { addressLine1: true, city: true } } },
    orderBy: { position: "asc" },
  });
  if (stops.length === 0) return [];

  const candidates = await db.package.findMany({
    where: {
      seasonId,
      fulfillmentMethod: { kind: "SHIPPING" },
      stage: { notIn: ["SENT", "PICKED_UP"] },
      routeStop: null,
      lines: { some: {} },
    },
    include: { shipments: { where: { status: "PURCHASED" }, select: { id: true } } },
  });

  const suggestions: RerouteSuggestion[] = [];
  for (const pkg of candidates) {
    const coordinates = await geocodeAddress(addressOf(pkg));
    let best: { distance: number | null; position: number; reason: "radius" | "same_street" } | null = null;
    for (const stop of stops) {
      if (coordinates && stop.latitude !== null && stop.longitude !== null) {
        const d = distanceMiles(coordinates, { latitude: stop.latitude, longitude: stop.longitude } as LatLng);
        if (d <= REROUTE_RADIUS_MILES && (best === null || (best.distance !== null && d < best.distance) || best.distance === null)) {
          best = { distance: d, position: stop.position, reason: "radius" };
        }
      }
      if (!best && sameStreet(pkg.addressLine1, pkg.city, stop.package.addressLine1, stop.package.city)) {
        best = { distance: null, position: stop.position, reason: "same_street" };
      }
    }
    if (best) {
      suggestions.push({
        packageId: pkg.id,
        recipientName: pkg.recipientName,
        address: `${pkg.addressLine1}, ${pkg.city} ${pkg.zip}`,
        stage: pkg.stage,
        distanceMiles: best.distance === null ? null : Math.round(best.distance * 100) / 100,
        nearStopPosition: best.position,
        reason: best.reason,
        hasActiveLabel: pkg.shipments.length > 0,
      });
    }
  }
  return suggestions.sort((a, b) => (a.distanceMiles ?? 99) - (b.distanceMiles ?? 99));
}

/**
 * Manager-confirmed reroute (UR-004, G-023): switch the shipping package to
 * the route's delivery method (voiding its label via the switch) and create
 * the route stop — all in ONE transaction. The stop lands after its nearest
 * existing stop (later positions shift), so the driver's nearest-neighbor
 * order survives the reroute. A sent package refuses in the switch guard.
 */
export async function confirmReroute(
  seasonId: string,
  routeId: string,
  packageId: string,
  staff: { id: string; email: string }
) {
  const route = await loadRoute(seasonId, routeId);
  if (route.status === "COMPLETED") throw new ActionError("This route already completed — build a new one");

  const firstStop = await db.routeStop.findFirst({
    where: { routeId },
    orderBy: { position: "asc" },
    include: { package: { select: { fulfillmentMethodId: true } } },
  });
  const targetMethodId =
    firstStop?.package.fulfillmentMethodId ??
    (await db.fulfillmentMethod.findFirst({ where: { kind: "PER_PACKAGE_DELIVERY", isActive: true } }))?.id;
  if (!targetMethodId) throw new ActionError("No delivery method exists to reroute onto", 409);

  const pkg = await db.package.findFirst({ where: { id: packageId, seasonId } });
  if (!pkg) throw new ActionError("Package not found", 404);
  // External geocode stays outside the transaction; coordinates are a snapshot.
  const coordinates = await geocodeAddress(addressOf(pkg));

  const { extra: stop } = await switchPackageMethod(seasonId, packageId, targetMethodId, staff, async (tx) => {
    // Re-verify inside the transaction: a concurrent build/reroute may have
    // placed this package on a route since the suggestion was rendered.
    const existing = await tx.routeStop.findUnique({ where: { packageId }, select: { id: true } });
    if (existing) throw new ActionError("This package just landed on another route — refresh the suggestions", 409);

    const stops = await tx.routeStop.findMany({
      where: { routeId },
      select: { position: true, latitude: true, longitude: true, deliveredAt: true },
      orderBy: { position: "asc" },
    });
    // Insert after the geographically nearest stop, but never before a stop
    // the driver already delivered.
    const lastPosition = stops.length > 0 ? stops[stops.length - 1].position : 0;
    let insertAfter = lastPosition;
    if (coordinates) {
      let bestDistance = Infinity;
      for (const entry of stops) {
        if (entry.latitude === null || entry.longitude === null) continue;
        const d = distanceMiles(coordinates, { latitude: entry.latitude, longitude: entry.longitude });
        if (d < bestDistance) {
          bestDistance = d;
          insertAfter = entry.position;
        }
      }
    }
    const lastDelivered = stops.reduce((max, entry) => (entry.deliveredAt ? Math.max(max, entry.position) : max), 0);
    insertAfter = Math.max(insertAfter, lastDelivered);

    await tx.routeStop.updateMany({
      where: { routeId, position: { gt: insertAfter } },
      data: { position: { increment: 1 } },
    });
    const created = await tx.routeStop.create({
      data: {
        routeId,
        packageId,
        position: insertAfter + 1,
        latitude: coordinates?.latitude,
        longitude: coordinates?.longitude,
      },
    });
    await tx.auditLog.create({
      data: {
        actorStaffId: staff.id,
        actorEmail: staff.email,
        action: "route.rerouted_package",
        targetType: "Package",
        targetId: packageId,
        detail: { routeId, stopId: created.id },
      },
    });
    return created;
  });

  // A route already on the road still owes the customer a day-of heads-up.
  if (route.status === "IN_PROGRESS") await captureDayOfNotifications(routeId, route.name);
  return stop;
}
