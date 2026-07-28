import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

// Geocode provider seam (R-162). No live geocoding API is reachable from this
// host, so the dev provider derives a STABLE lat/lng from the normalized
// address key (same address always geocodes the same) inside the Lakewood NJ
// service area. Results cache in GeocodeCache with a TTL exactly as a live
// provider's would; swapping in Google/Mapbox means replacing `derive` only.
const PROVIDER = "deterministic-dev";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function deriveGeoPoint(addressKey: string): { lat: number; lng: number } {
  const hash = createHash("sha256").update(addressKey).digest();
  const latSeed = hash.readUInt32BE(0) / 0xffffffff;
  const lngSeed = hash.readUInt32BE(4) / 0xffffffff;
  return {
    lat: 39.95 + latSeed * 0.25, // 39.95..40.20
    lng: -74.35 + lngSeed * 0.25, // -74.35..-74.10
  };
}

export async function geocodeAddress(
  addressKey: string,
  options?: { persist?: boolean },
): Promise<{ lat: number; lng: number }> {
  const cached = await prisma.geocodeCache.findUnique({ where: { addressKey } });
  if (cached && cached.expiresAt > new Date()) {
    return { lat: cached.lat, lng: cached.lng };
  }
  const point = deriveGeoPoint(addressKey);
  // Unauthenticated probes (addresses/validate) read the cache but must not
  // grow it — caller-chosen keys would bloat the table unboundedly.
  if (options?.persist === false) return point;
  const expiresAt = new Date(Date.now() + TTL_MS);
  await prisma.geocodeCache.upsert({
    where: { addressKey },
    update: { lat: point.lat, lng: point.lng, provider: PROVIDER, fetchedAt: new Date(), expiresAt },
    create: { addressKey, lat: point.lat, lng: point.lng, provider: PROVIDER, expiresAt },
  });
  return point;
}
