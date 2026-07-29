import { z } from "zod";
import { env } from "@/lib/env";
import { GeoPoint, haversineMiles } from "@/lib/routes/geo";

// R-074/R-179 stop ordering. Provider seam, same honesty class as the P4
// geocode seam: with MAPBOX_ACCESS_TOKEN the Mapbox Optimization API
// (optimized-trips v1, verified docs: GET /optimized-trips/v1/{profile}/
// {lng,lat;…} with source=first, waypoints[] returned in input order carrying
// waypoint_index) orders the stops; without it — or on ANY provider failure —
// a deterministic greedy nearest-neighbor runs instead. The dev geocoder
// keeps both paths reproducible locally.

export interface OptimizeResult {
  // Stop indices (into the caller's stop array) in visit order.
  order: number[];
  provider: "mapbox" | "nearest-neighbor";
}

export function orderStopsNearestNeighbor(origin: GeoPoint, stops: GeoPoint[]): number[] {
  const remaining = stops.map((_, index) => index);
  const order: number[] = [];
  let current = origin;
  while (remaining.length > 0) {
    let bestPosition = 0;
    let bestDistance = Infinity;
    for (let position = 0; position < remaining.length; position += 1) {
      const distance = haversineMiles(current, stops[remaining[position]]);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPosition = position;
      }
    }
    const [next] = remaining.splice(bestPosition, 1);
    order.push(next);
    current = stops[next];
  }
  return order;
}

// Mapbox caps a request at 12 coordinates; origin + 11 stops is the ceiling.
const MAPBOX_MAX_STOPS = 11;

const mapboxResponseSchema = z.object({
  code: z.string(),
  waypoints: z
    .array(
      z.object({
        waypoint_index: z.number().int(),
      }),
    )
    .optional(),
});

async function orderStopsMapbox(origin: GeoPoint, stops: GeoPoint[]): Promise<number[]> {
  const coordinates = [origin, ...stops].map((point) => `${point.lng},${point.lat}`).join(";");
  const url =
    `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordinates}` +
    `?source=first&destination=any&roundtrip=false&access_token=${encodeURIComponent(env.MAPBOX_ACCESS_TOKEN!)}`;
  const response = await fetch(url, { headers: { "user-agent": "tomchei-shabbos-arm06/1.0" } });
  if (!response.ok) throw new Error(`Mapbox optimization answered HTTP ${response.status}`);
  const parsed = mapboxResponseSchema.parse(await response.json());
  if (parsed.code !== "Ok" || !parsed.waypoints || parsed.waypoints.length !== stops.length + 1) {
    throw new Error(`Mapbox optimization returned code ${parsed.code}; expected Ok with ${stops.length + 1} waypoints`);
  }
  // waypoints arrive in INPUT order; waypoint_index is the visit position.
  // Input 0 is the origin (fixed first by source=first) — drop it.
  return parsed.waypoints
    .slice(1)
    .map((waypoint, inputIndex) => ({ inputIndex, visit: waypoint.waypoint_index }))
    .sort((a, b) => a.visit - b.visit)
    .map((entry) => entry.inputIndex);
}

export async function orderStops(origin: GeoPoint, stops: GeoPoint[]): Promise<OptimizeResult> {
  if (stops.length <= 1) return { order: stops.map((_, index) => index), provider: "nearest-neighbor" };
  if (env.MAPBOX_ACCESS_TOKEN && stops.length <= MAPBOX_MAX_STOPS) {
    try {
      return { order: await orderStopsMapbox(origin, stops), provider: "mapbox" };
    } catch {
      // Provider down/over limit/misconfigured — the deterministic optimizer
      // is the documented fallback, never a route-build failure.
    }
  }
  return { order: orderStopsNearestNeighbor(origin, stops), provider: "nearest-neighbor" };
}
