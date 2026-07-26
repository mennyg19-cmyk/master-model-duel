import 'server-only';

import type { GeocodeCache, GeocodeOutcome } from '@prisma/client';

import { db } from './db';

/**
 * A street address that resolved once keeps resolving, so hits are cached for a
 * season. A miss is usually a typo somebody fixes within the hour, so it is
 * kept just long enough to stop a retry loop from billing the provider (R-162).
 */
export const GEOCODE_SUCCESS_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const GEOCODE_FAILURE_TTL_MS = 60 * 60 * 1000;

export type GeocodeResult = {
  addressKey: string;
  outcome: GeocodeOutcome;
  latitude?: number | null;
  longitude?: number | null;
  provider: string;
};

/** Null means "ask the provider": either nothing is cached or it has expired. */
export async function readGeocodeCache(
  addressKey: string,
  now: Date = new Date(),
): Promise<GeocodeCache | null> {
  const cached = await db.geocodeCache.findUnique({ where: { addressKey } });
  if (!cached) return null;

  return cached.expiresAt > now ? cached : null;
}

export async function writeGeocodeCache(
  geocode: GeocodeResult,
  now: Date = new Date(),
): Promise<GeocodeCache> {
  const ttlMs = geocode.outcome === 'FOUND' ? GEOCODE_SUCCESS_TTL_MS : GEOCODE_FAILURE_TTL_MS;
  const row = {
    outcome: geocode.outcome,
    latitude: geocode.latitude ?? null,
    longitude: geocode.longitude ?? null,
    provider: geocode.provider,
    expiresAt: new Date(now.getTime() + ttlMs),
  };

  return db.geocodeCache.upsert({
    where: { addressKey: geocode.addressKey },
    create: { addressKey: geocode.addressKey, ...row },
    update: row,
  });
}
