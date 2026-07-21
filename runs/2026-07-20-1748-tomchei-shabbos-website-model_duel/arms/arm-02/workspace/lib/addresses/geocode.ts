import { createHash } from "crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
/** The address fields geocoding actually reads — anything address-shaped qualifies. */
export type GeocodableAddress = { line1: string; city: string; state: string; zip: string };

// Geocoding behind the GeocodeCache contract (R-162, R-179). With
// MAPBOX_ACCESS_TOKEN set, lookups hit Mapbox's geocoding API; without it the
// local provider answers: the ZIP centroid plus a deterministic street-level
// offset (hash of street + house number, up to ~0.35 mile), so route ordering
// and the nearby-reroute rule behave like real coordinates in dev.
/** Warehouse centroid (Lakewood 08701) — the single source of the route-origin fallback. */
export const WAREHOUSE_ORIGIN = { latitude: 40.0821, longitude: -74.2097 };

const ZIP_CENTROIDS: Record<string, { latitude: number; longitude: number }> = {
  "08701": WAREHOUSE_ORIGIN,
  "08527": { latitude: 40.1004, longitude: -74.3126 },
  "08753": { latitude: 39.9779, longitude: -74.1832 },
  "08755": { latitude: 40.0069, longitude: -74.2205 },
};

const CACHE_TTL_DAYS = 30;
// ~0.35 mile in degrees of latitude.
const LOCAL_MAX_OFFSET_DEG = 0.005;

function localCoordinates(address: GeocodableAddress) {
  const centroid = ZIP_CENTROIDS[address.zip];
  if (!centroid) return null;
  // Streets cluster: the street name picks a base offset, the house number
  // nudges along it — so neighbors land near each other and different streets
  // land apart (what sameStreet/0.5-mile reroute suggestions need).
  const line1 = address.line1.trim().toLowerCase();
  const houseNumber = /^(\d+)/.exec(line1)?.[1] ?? "0";
  const street = line1.replace(/^\d+[a-z]?\s+/, "");
  const digest = createHash("sha256").update(street).digest();
  const unit = (byte: number) => (byte / 255) * 2 - 1; // -1..1
  const along = (Number(houseNumber) % 100) / 100; // 0..1 along the street
  return {
    latitude: centroid.latitude + unit(digest[0]) * LOCAL_MAX_OFFSET_DEG + along * 0.0005,
    longitude: centroid.longitude + unit(digest[1]) * LOCAL_MAX_OFFSET_DEG + along * 0.0005,
  };
}

async function mapboxCoordinates(address: GeocodableAddress) {
  const query = encodeURIComponent(`${address.line1}, ${address.city}, ${address.state} ${address.zip}`);
  const response = await fetch(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?limit=1&access_token=${env.MAPBOX_ACCESS_TOKEN}`,
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { features?: { center?: [number, number] }[] };
  const center = body.features?.[0]?.center;
  if (!center) return null;
  return { latitude: center[1], longitude: center[0] };
}

/**
 * Geocode through the TTL cache (R-162). Returns null when the area is
 * unknown — callers store the address anyway; lat/lng just stay empty.
 */
export async function geocodeAddress(address: GeocodableAddress) {
  const addressHash = createHash("sha256")
    .update(`${address.line1}|${address.city}|${address.state}|${address.zip}`.toLowerCase())
    .digest("hex");

  const cached = await db.geocodeCache.findUnique({ where: { addressHash } });
  if (cached && cached.expiresAt > new Date()) {
    return { latitude: cached.latitude, longitude: cached.longitude };
  }

  let provider = "local-street-offset";
  let coordinates = null;
  if (env.MAPBOX_ACCESS_TOKEN) {
    coordinates = await mapboxCoordinates(address).catch(() => null);
    provider = "mapbox";
  }
  if (!coordinates) {
    coordinates = localCoordinates(address);
    provider = "local-street-offset";
  }
  if (!coordinates) return null;

  await db.geocodeCache.upsert({
    where: { addressHash },
    update: {
      ...coordinates,
      provider,
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + CACHE_TTL_DAYS * 24 * 3600 * 1000),
    },
    create: {
      addressHash,
      ...coordinates,
      provider,
      expiresAt: new Date(Date.now() + CACHE_TTL_DAYS * 24 * 3600 * 1000),
    },
  });
  return coordinates;
}
