import 'server-only';

import { readSetting } from '../settings';
import { geocodeAddress, milesBetween, type GeocodePoint } from './geocode';

/**
 * What order the van drives the stops in (R-075).
 *
 * Nearest neighbour from the shipping room, which is where the van starts.
 *
 * ponytail: nearest-neighbour, not the shortest possible tour — that is a
 * famously hard problem and a volunteer with a phone does not need one. It is
 * the difference between a sensible order and alphabetical, which is what a
 * manager would otherwise get. Ceiling: on a run with two clusters it can
 * double back once. Upgrade path is a 2-opt pass over this same output, which
 * needs no new data and no provider.
 *
 * Stops nobody could place go on the end, so the driver deals with them last
 * with the office on the phone.
 */
export type PlacedStop = { packageId: string; point: GeocodePoint | null };

export function orderStops(stops: PlacedStop[], origin: GeocodePoint | null): PlacedStop[] {
  const placed = stops.filter((stop): stop is PlacedStop & { point: GeocodePoint } => stop.point !== null);
  const unplaced = stops.filter((stop) => stop.point === null);

  const remaining = [...placed];
  const ordered: PlacedStop[] = [];
  let cursor = origin ?? placed[0]?.point ?? null;

  while (remaining.length > 0 && cursor !== null) {
    const here = cursor;
    let nearestIndex = 0;

    for (const [index, stop] of remaining.entries()) {
      if (milesBetween(here, stop.point) < milesBetween(here, remaining[nearestIndex].point)) {
        nearestIndex = index;
      }
    }

    const [next] = remaining.splice(nearestIndex, 1);
    ordered.push(next);
    cursor = next.point;
  }

  return [...ordered, ...remaining, ...unplaced];
}

/** The shipping room's own coordinates, so a route starts where the van does. */
export async function originPoint(): Promise<GeocodePoint | null> {
  const origin = await readSetting('shipping.origin');
  if (origin.line1 === '' || origin.postalCode === '') return null;

  const answer = await geocodeAddress({
    line1: origin.line1,
    line2: origin.line2 || null,
    city: origin.city,
    state: origin.state,
    postalCode: origin.postalCode,
    country: 'US',
  });

  return answer.point;
}
