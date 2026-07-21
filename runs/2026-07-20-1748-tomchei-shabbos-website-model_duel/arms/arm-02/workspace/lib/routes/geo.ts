// Pure geometry helpers for delivery routes (R-074) and the reroute-nearby
// rule (G-023). Distances are miles; coordinates are plain lat/lng.

export type LatLng = { latitude: number; longitude: number };

const EARTH_RADIUS_MILES = 3958.8;

export function distanceMiles(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

/**
 * Order stops nearest-neighbor starting from the origin (warehouse). Stops
 * without coordinates keep their relative order at the end — a human can still
 * drive them; the map just can't place them.
 */
export function nearestNeighborOrder<T extends { coordinates: LatLng | null }>(
  origin: LatLng,
  stops: T[]
): T[] {
  const placeable = stops.filter((stop) => stop.coordinates !== null);
  const unplaceable = stops.filter((stop) => stop.coordinates === null);

  const ordered: T[] = [];
  let current = origin;
  const remaining = [...placeable];
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = distanceMiles(current, remaining[i].coordinates!);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = i;
      }
    }
    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next);
    current = next.coordinates!;
  }
  return [...ordered, ...unplaceable];
}

/** Same-street cluster rule (G-023): street name (digits stripped) + city match. */
export function sameStreet(line1A: string, cityA: string, line1B: string, cityB: string): boolean {
  const street = (line1: string) =>
    line1
      .toLowerCase()
      .replace(/^\s*\d+[a-z]?\s+/, "")
      .replace(/[.,#]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  return street(line1A) !== "" && street(line1A) === street(line1B) && cityA.trim().toLowerCase() === cityB.trim().toLowerCase();
}

/** Google Maps deep link for one stop (G-030). */
export function googleMapsUrl(address: { line1: string; city: string; state: string; zip: string }): string {
  const destination = `${address.line1}, ${address.city}, ${address.state} ${address.zip}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
