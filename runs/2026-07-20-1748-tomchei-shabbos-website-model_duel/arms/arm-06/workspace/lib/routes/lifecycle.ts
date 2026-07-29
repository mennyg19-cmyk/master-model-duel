import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { groupByCustomer } from "@/lib/notify/by-customer";
import { sendNotification } from "@/lib/notify/outbox";
import { googleMapsDirectionsUrl } from "@/lib/routes/geo";
import { writeRouteEvent } from "@/lib/routes/events";
import { parseMethodStages, assertCanAdvanceStage, PackageEventAction } from "@/lib/packages/stages";
import { BRAND } from "@/lib/brand";

// G-025/G-030: route lifecycle — start (fires the idempotent day-of
// notification), per-stop delivery with the audit tap, completion (the link
// dies). Driver reads are minimized: recipient name, address, contents — no
// customer contact PII, no order internals.

export interface DriverStopCard {
  stopId: string;
  seq: number;
  recipientName: string;
  address: { line1: string; line2: string | null; city: string; region: string; postalCode: string };
  mapsUrl: string;
  contents: string[];
  // m11: the printed manifest shows "Greeting card enclosed" — the driver app
  // surfaces the same fact so the card is never left in the van.
  greeting: boolean;
  deliveredAt: string | null;
}

export interface DriverRouteView {
  routeId: string;
  name: string;
  deliveryDay: string | null;
  status: string;
  stops: DriverStopCard[];
}

export async function loadDriverRouteView(routeId: string): Promise<DriverRouteView> {
  const route = await prisma.deliveryRoute.findUnique({
    where: { id: routeId },
    include: {
      stops: {
        orderBy: { seq: "asc" },
        include: {
          package: {
            select: {
              greeting: true,
              lines: { select: { qty: true, orderLine: { select: { productName: true, optionLabel: true } } } },
            },
          },
        },
      },
    },
  });
  if (!route) throw new NotFoundError("DeliveryRoute", routeId);
  return {
    routeId: route.id,
    name: route.name,
    deliveryDay: route.deliveryDay,
    status: route.status,
    stops: route.stops.map((stop) => {
      const address = {
        line1: stop.addressLine1,
        line2: stop.addressLine2,
        city: stop.city,
        region: stop.region,
        postalCode: stop.postalCode,
      };
      return {
        stopId: stop.id,
        seq: stop.seq,
        recipientName: stop.recipientName,
        address,
        mapsUrl: googleMapsDirectionsUrl(address),
        contents: stop.package.lines.map(
          (line) => `${line.qty} x ${line.orderLine.productName}${line.orderLine.optionLabel ? ` (${line.orderLine.optionLabel})` : ""}`,
        ),
        greeting: stop.package.greeting !== null,
        deliveredAt: stop.deliveredAt?.toISOString() ?? null,
      };
    }),
  };
}

export interface StartRouteResult {
  alreadyStarted: boolean;
  notifiedCustomers: number;
}

// Driver taps "start route". Day-of notification law: exactly one email + one
// SMS per affected CUSTOMER, ever — re-starting (second device, retry after a
// crash) sends nothing because the stops carry dayOfNotifiedAt.
export async function startRoute(input: { routeId: string; linkId?: string | null }): Promise<StartRouteResult> {
  return prisma.$transaction(async (tx) => {
    const route = await tx.deliveryRoute.findUnique({
      where: { id: input.routeId },
      include: {
        stops: {
          orderBy: { seq: "asc" },
          include: {
            package: {
              select: {
                order: { select: { id: true, wireFormat: true, customer: { select: { id: true, name: true, email: true, phone: true } } } },
              },
            },
          },
        },
      },
    });
    if (!route) throw new NotFoundError("DeliveryRoute", input.routeId);
    if (route.status === "COMPLETED") {
      throw new DomainRuleError(`Route ${input.routeId} is already completed; a finished run cannot restart`);
    }
    if (route.status === "STARTED") {
      return { alreadyStarted: true as const, notifiedCustomers: 0 };
    }

    await tx.deliveryRoute.update({
      where: { id: route.id },
      data: { status: "STARTED", startedAt: new Date() },
    });
    await writeRouteEvent(tx, route.id, "route_started", { linkId: input.linkId ?? null });

    // Group stops by CUSTOMER so a customer with several packages on the run
    // — even across two orders — gets ONE notification listing every
    // recipient, not one tap per package (m18 shared helper).
    const byCustomer = groupByCustomer(
      route.stops.filter((stop) => stop.dayOfNotifiedAt === null),
      (stop) => stop.package.order.customer.id,
      (stop) => stop.package.order.customer,
      (stop) => stop.recipientName,
      (stop) => stop.package.order.id,
    );

    const notifiedAt = new Date();
    for (const [, entry] of byCustomer) {
      const recipientList = entry.recipients.join(", ");
      await sendNotification(
        {
          kind: "day_of_delivery",
          recipient: { email: entry.customer.email, phone: entry.customer.phone },
          subject: `${BRAND.orgName}: your delivery is on its way`,
          body: `Hello ${entry.customer.name},\n\nYour ${BRAND.orgName} delivery is out for delivery today${route.deliveryDay ? ` (${route.deliveryDay})` : ""}. The driver is heading to: ${recipientList}.\n\nThank you for supporting ${BRAND.orgName}.`,
          smsBody: `${BRAND.orgName}: your delivery is on its way today${route.deliveryDay ? ` (${route.deliveryDay})` : ""} — heading to ${recipientList}.`,
          orderId: [...entry.orderIds][0],
          // m6: the FK carries the first order; metadata carries them ALL, so
          // a deleted order never orphans the audit link to the others.
          metadata: {
            routeId: route.id,
            routeName: route.name,
            stopCount: entry.items.length,
            orderCount: entry.orderIds.size,
            orderIds: [...entry.orderIds],
          },
        },
        tx,
      );
      await tx.routeStop.updateMany({
        where: { id: { in: entry.items.map((stop) => stop.id) } },
        data: { dayOfNotifiedAt: notifiedAt },
      });
    }

    return { alreadyStarted: false as const, notifiedCustomers: byCustomer.size };
  });
}

export interface DeliverStopResult {
  alreadyDelivered: boolean;
  routeCompleted: boolean;
}

// The Delivered tap (driver link or staff paper fallback). The stop claim is
// an atomic updateMany on deliveredAt IS NULL, so a double-tap or two devices
// can never double-audit. The package advances to its terminal stage by its
// own method's stage law; the route completes when the last stop lands.
export async function markStopDelivered(input: {
  routeId: string;
  stopId: string;
  via: { linkId: string } | { staffId: string };
}): Promise<DeliverStopResult> {
  return prisma.$transaction(async (tx) => {
    const route = await tx.deliveryRoute.findUnique({ where: { id: input.routeId }, include: { stops: true } });
    if (!route) throw new NotFoundError("DeliveryRoute", input.routeId);
    if (route.status !== "STARTED") {
      throw new DomainRuleError(`Route ${input.routeId} is ${route.status}; the driver must start the route before marking stops delivered`);
    }
    const stop = route.stops.find((candidate) => candidate.id === input.stopId);
    if (!stop) throw new NotFoundError("RouteStop", input.stopId);

    const claimed = await tx.routeStop.updateMany({
      where: { id: stop.id, deliveredAt: null },
      data: { deliveredAt: new Date() },
    });
    if (claimed.count === 0) {
      // A double-tap mid-run: the route is STARTED (guarded above), so it
      // cannot have completed between the taps.
      return { alreadyDelivered: true as const, routeCompleted: false };
    }

    const pkg = await tx.package.findUnique({
      where: { id: stop.packageId },
      include: { fulfillmentMethod: true },
    });
    if (!pkg) throw new NotFoundError("Package", stop.packageId);
    // M2: advance unconditionally — the package WAS delivered and the route is
    // the authority, not the season flag. A season closing mid-run must never
    // strand a delivered package at PACKED/PRINTED.
    const methodStages = parseMethodStages(pkg.fulfillmentMethod.stages, pkg.fulfillmentMethod.code);
    if (pkg.stage !== pkg.fulfillmentMethod.terminalStage) {
      assertCanAdvanceStage(pkg.stage, pkg.fulfillmentMethod.terminalStage, methodStages, pkg.fulfillmentMethod.code);
      const advanced = await tx.package.updateMany({
        where: { id: pkg.id, version: pkg.version },
        data: { stage: pkg.fulfillmentMethod.terminalStage, version: { increment: 1 } },
      });
      if (advanced.count === 0) {
        throw new DomainRuleError(`Package ${pkg.id} changed concurrently while marking delivered; reload and retry the tap`);
      }
    }
    const deliveredAction: PackageEventAction = "delivered";
    await tx.packageEvent.create({
      data: {
        packageId: stop.packageId,
        action: deliveredAction,
        actorId: "staffId" in input.via ? input.via.staffId : null,
        metadata: {
          routeId: route.id,
          stopId: stop.id,
          ...("linkId" in input.via ? { linkId: input.via.linkId, via: "magic_link" } : { via: "staff" }),
        },
      },
    });
    await writeRouteEvent(tx, route.id, "stop_delivered", {
      stopId: stop.id,
      linkId: "linkId" in input.via ? input.via.linkId : null,
      actorId: "staffId" in input.via ? input.via.staffId : null,
      metadata: { packageId: stop.packageId },
    });

    const remaining = await tx.routeStop.count({ where: { routeId: route.id, deliveredAt: null } });
    let routeCompleted = false;
    if (remaining === 0) {
      routeCompleted = true;
      await tx.deliveryRoute.update({ where: { id: route.id }, data: { status: "COMPLETED", completedAt: new Date() } });
      await writeRouteEvent(tx, route.id, "route_completed", {
        linkId: "linkId" in input.via ? input.via.linkId : null,
        actorId: "staffId" in input.via ? input.via.staffId : null,
      });
    }
    return { alreadyDelivered: false as const, routeCompleted };
  });
}
