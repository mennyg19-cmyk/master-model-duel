import 'server-only';

import { toAddressParts } from '../addresses/address-mapping';
import { addressSummary } from '../addresses/address-summary';
import { db } from '../db';
import { boardScopeWhere } from '../fulfillment/channel-summary';
import { formatOrderLabel } from '../orders/order-labels';
import { isActiveLabel } from '../shipping/label-status';
import { geocodeAddress, milesBetween, type GeocodePoint } from './geocode';

/**
 * Shipping boxes the van would drive past anyway (G-027).
 *
 * Only boxes that have not gone out: a sent box is at the carrier, and lifting
 * it onto a van would mean two of them turning up. Boxes with no coordinates are
 * left out rather than guessed at — a suggestion has to be able to say how far.
 *
 * It reads with the route screens rather than with the reroute service because
 * that is who asks for it: the list is a view, and the decision it leads to is
 * somewhere else.
 */

/** Half a mile, the "the van is already outside" rule from the plan (G-027). */
const NEARBY_MILES = 0.5;

/**
 * How long a route's list is reused.
 *
 * Every candidate costs a geocode lookup, and the route screen re-renders on
 * every `revalidatePath` — a start, a delivered tap, a reissued link. Without
 * this, marking three stops delivered geocodes the whole shipping board three
 * times over. A minute is short enough that a box sold during the run shows up
 * on the next reload, and anything that actually moves a box clears the entry
 * itself.
 */
const SUGGESTIONS_TTL_MS = 60_000;

const cached = new Map<string, { computedAt: number; suggestions: NearbySuggestion[] }>();

export type NearbySuggestion = {
  packageId: string;
  recipientName: string;
  addressLine: string;
  milesFromStop: number;
  nearestStopRecipient: string;
  hasLiveLabel: boolean;
  orderLabel: string;
};

export async function nearbySuggestions(
  seasonId: string,
  routeId: string,
): Promise<NearbySuggestion[]> {
  const entry = cached.get(routeId);
  if (entry && Date.now() - entry.computedAt < SUGGESTIONS_TTL_MS) return entry.suggestions;

  const suggestions = await computeNearbySuggestions(seasonId, routeId);
  cached.set(routeId, { computedAt: Date.now(), suggestions });

  return suggestions;
}

/** Anything that moves a box on or off a van makes this route's list wrong. */
export function forgetNearbySuggestions(routeId: string): void {
  cached.delete(routeId);
}

async function computeNearbySuggestions(
  seasonId: string,
  routeId: string,
): Promise<NearbySuggestion[]> {
  const stops = await db.routeStop.findMany({
    where: { routeId, latitude: { not: null }, longitude: { not: null } },
    include: { package: { select: { recipientName: true } } },
  });

  if (stops.length === 0) return [];

  const candidates = await db.package.findMany({
    where: {
      ...boardScopeWhere(seasonId),
      fulfillmentMethod: { kind: 'SHIPPING' },
      stage: { in: ['NEW', 'PRINTED', 'PACKED'] },
      routeStop: null,
    },
    include: {
      shipmentBoxes: { select: { status: true } },
      order: { select: { orderNumber: true, draftReference: true } },
    },
  });

  const suggestions: NearbySuggestion[] = [];

  for (const box of candidates) {
    const address = toAddressParts(box);
    if (!address) continue;

    const answer = await geocodeAddress(address);
    if (!answer.point) continue;

    const nearest = nearestStop(answer.point, stops);
    if (!nearest || nearest.miles > NEARBY_MILES) continue;

    suggestions.push({
      packageId: box.id,
      recipientName: box.recipientName,
      addressLine: addressSummary(address),
      milesFromStop: Number(nearest.miles.toFixed(2)),
      nearestStopRecipient: nearest.recipientName,
      hasLiveLabel: box.shipmentBoxes.some((parcel) => isActiveLabel(parcel.status)),
      orderLabel: formatOrderLabel(box.order),
    });
  }

  return suggestions.sort((left, right) => left.milesFromStop - right.milesFromStop);
}

type StopPoint = { latitude: number | null; longitude: number | null; package: { recipientName: string } };

function nearestStop(
  point: GeocodePoint,
  stops: StopPoint[],
): { miles: number; recipientName: string } | null {
  let best: { miles: number; recipientName: string } | null = null;

  for (const stop of stops) {
    if (stop.latitude === null || stop.longitude === null) continue;

    const miles = milesBetween(point, { latitude: stop.latitude, longitude: stop.longitude });
    if (!best || miles < best.miles) best = { miles, recipientName: stop.package.recipientName };
  }

  return best;
}
