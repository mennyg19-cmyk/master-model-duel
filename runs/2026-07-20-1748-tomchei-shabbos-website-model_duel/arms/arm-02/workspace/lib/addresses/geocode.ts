import { createHash } from "crypto";
import { db } from "@/lib/db";
import type { AddressInput } from "@/lib/addresses/normalize";

// ZIP centroids for the delivery area. No geocoding API key exists in this
// environment, so the provider is a local lookup table — the GeocodeCache
// contract (R-162) is the same, and swapping in a real provider later means
// replacing lookupCoordinates only.
const ZIP_CENTROIDS: Record<string, { latitude: number; longitude: number }> = {
  "08701": { latitude: 40.0821, longitude: -74.2097 },
  "08527": { latitude: 40.1004, longitude: -74.3126 },
  "08753": { latitude: 39.9779, longitude: -74.1832 },
  "08755": { latitude: 40.0069, longitude: -74.2205 },
};

const CACHE_TTL_DAYS = 30;
const PROVIDER = "local-zip-centroid";

function lookupCoordinates(zip: string) {
  return ZIP_CENTROIDS[zip] ?? null;
}

/**
 * Geocode through the TTL cache (R-162). Returns null when the area is
 * unknown — callers store the address anyway; lat/lng just stay empty.
 */
export async function geocodeAddress(address: AddressInput) {
  const addressHash = createHash("sha256")
    .update(`${address.line1}|${address.city}|${address.state}|${address.zip}`.toLowerCase())
    .digest("hex");

  const cached = await db.geocodeCache.findUnique({ where: { addressHash } });
  if (cached && cached.expiresAt > new Date()) {
    return { latitude: cached.latitude, longitude: cached.longitude };
  }

  const coordinates = lookupCoordinates(address.zip);
  if (!coordinates) return null;

  await db.geocodeCache.upsert({
    where: { addressHash },
    update: {
      ...coordinates,
      provider: PROVIDER,
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + CACHE_TTL_DAYS * 24 * 3600 * 1000),
    },
    create: {
      addressHash,
      ...coordinates,
      provider: PROVIDER,
      expiresAt: new Date(Date.now() + CACHE_TTL_DAYS * 24 * 3600 * 1000),
    },
  });
  return coordinates;
}
