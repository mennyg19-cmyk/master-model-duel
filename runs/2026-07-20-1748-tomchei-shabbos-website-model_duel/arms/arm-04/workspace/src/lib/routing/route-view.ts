import 'server-only';

import type { DeliveryRouteStatus, Prisma, RouteStopStatus } from '@prisma/client';

import { toAddressParts, type AddressParts } from '../addresses/address-mapping';
import { addressSummary } from '../addresses/address-summary';
import { db } from '../db';
import { sumLineQuantities } from '../orders/lines';
import { formatOrderLabel } from '../orders/order-labels';
import { mapsDirectionsHref } from './maps';

/**
 * What the route screens read.
 *
 * The driver's view and the office's view come from the same query on purpose:
 * the printed sheet, the phone and the admin page have to agree about what is on
 * the van, in what order. What differs is only how much of the row each caller
 * is allowed to see, which is decided by the page, not by a second query.
 */
const STOP_INCLUDE = {
  package: {
    include: {
      fulfillmentMethod: { select: { label: true, kind: true } },
      lines: { select: { quantity: true } },
      order: {
        select: {
          orderNumber: true,
          draftReference: true,
          customer: { select: { fullName: true, phone: true } },
        },
      },
    },
  },
} satisfies Prisma.RouteStopInclude;

export type RouteStopView = {
  id: string;
  sequence: number;
  status: RouteStopStatus;
  deliveredAt: Date | null;
  recipientName: string;
  address: AddressParts | null;
  addressLine: string;
  mapsHref: string | null;
  greetingMessage: string | null;
  itemCount: number;
  deliveryWindow: string | null;
  packageId: string;
  orderLabel: string;
  /** The phone the driver rings when nobody answers the door. */
  contactPhone: string | null;
  placed: boolean;
};

export type RouteView = {
  id: string;
  label: string;
  deliveryDay: string | null;
  status: DeliveryRouteStatus;
  version: number;
  startedAt: Date | null;
  completedAt: Date | null;
  driverStaffUserId: string | null;
  driverName: string | null;
  stops: RouteStopView[];
  deliveredCount: number;
  unplacedCount: number;
};

/**
 * The office's read: a route id typed into a URL must not reach last year's.
 */
export function readRouteForAdmin(routeId: string, seasonId: string): Promise<RouteView | null> {
  return readRoute({ id: routeId, seasonId });
}

/**
 * The driver's and the printer's read.
 *
 * No season, deliberately: the caller already holds a credential for exactly
 * this route — a magic-link row or a season-scoped admin check — and the route
 * id came from that row rather than from a request. Splitting the two reads is
 * what stops the unscoped one being reached from a screen by accident.
 */
export function readRouteForLink(routeId: string): Promise<RouteView | null> {
  return readRoute({ id: routeId });
}

async function readRoute(
  where: Prisma.DeliveryRouteWhereInput,
): Promise<RouteView | null> {
  const route = await db.deliveryRoute.findFirst({
    where,
    include: {
      driver: { select: { fullName: true } },
      stops: { include: STOP_INCLUDE, orderBy: { sequence: 'asc' } },
    },
  });

  if (!route) return null;

  const stops = route.stops.map(toStopView);

  return {
    id: route.id,
    label: route.label,
    deliveryDay: route.deliveryDay,
    status: route.status,
    version: route.version,
    startedAt: route.startedAt,
    completedAt: route.completedAt,
    driverStaffUserId: route.driverStaffUserId,
    driverName: route.driver?.fullName ?? null,
    stops,
    deliveredCount: stops.filter((stop) => stop.status === 'DELIVERED').length,
    unplacedCount: stops.filter((stop) => !stop.placed).length,
  };
}

type StopRow = Prisma.RouteStopGetPayload<{ include: typeof STOP_INCLUDE }>;

function toStopView(stop: StopRow): RouteStopView {
  const box = stop.package;
  const address = toAddressParts(box);

  return {
    id: stop.id,
    sequence: stop.sequence,
    status: stop.status,
    deliveredAt: stop.deliveredAt,
    recipientName: box.recipientName,
    address,
    addressLine: address ? addressSummary(address) : 'No address on this box',
    mapsHref: address ? mapsDirectionsHref(address) : null,
    greetingMessage: box.greetingMessage,
    itemCount: sumLineQuantities(box.lines),
    deliveryWindow: box.deliveryWindow,
    packageId: box.id,
    orderLabel: formatOrderLabel(box.order),
    contactPhone: box.order.customer?.phone ?? null,
    placed: stop.latitude !== null && stop.longitude !== null,
  };
}

export type RouteListRow = {
  id: string;
  label: string;
  deliveryDay: string | null;
  status: DeliveryRouteStatus;
  driverName: string | null;
  stopCount: number;
  deliveredCount: number;
  hasLiveLink: boolean;
};

export async function listRoutes(seasonId: string): Promise<RouteListRow[]> {
  const routes = await db.deliveryRoute.findMany({
    where: { seasonId },
    include: {
      driver: { select: { fullName: true } },
      stops: { select: { status: true } },
      driverLinks: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } },
    },
    orderBy: [{ createdAt: 'desc' }],
  });

  return routes.map((route) => ({
    id: route.id,
    label: route.label,
    deliveryDay: route.deliveryDay,
    status: route.status,
    driverName: route.driver?.fullName ?? null,
    stopCount: route.stops.length,
    deliveredCount: route.stops.filter((stop) => stop.status === 'DELIVERED').length,
    hasLiveLink: route.driverLinks.length > 0,
  }));
}
