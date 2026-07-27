import 'server-only';

import { createHash } from 'node:crypto';

import type { AddressParts } from '../addresses/address-mapping';
import { normalizeAddressKey } from '../core/normalize';
import { env } from '../env';
import { readGeocodeCache, writeGeocodeCache } from '../geocode-cache';

/**
 * Turning a delivery address into a point on the map (R-074, R-179).
 *
 * Mapbox bills per lookup and a season's routes ask for the same few hundred
 * houses over and over, so every call goes through `GeocodeCache` first. The
 * cache is the one written by the address book, which means a house looked up
 * when the donor saved it is free when the route is planned.
 *
 * Without a token the offline stand-in places addresses instead. Its points are
 * made up, but they are stable and they cluster by ZIP, which is enough to order
 * a route and to test the reroute suggestion. `env-spec.ts` refuses it off this
 * machine, because a real driver sent to a made-up point is a wasted afternoon.
 */
export type GeocodePoint = { latitude: number; longitude: number };

export type GeocodeAnswer = {
  point: GeocodePoint | null;
  /**
   * Where the answer came from, for the screen that explains a missing stop.
   *
   * `mapbox-error` is the one that matters operationally: "Mapbox has never
   * heard of this address" and "Mapbox was down when we asked" both leave a
   * stop unplaced, but only the second is worth retrying.
   */
  source: 'cache' | 'mapbox' | 'mapbox-error' | 'offline';
};

const MAPBOX_ENDPOINT = 'https://api.mapbox.com/search/geocode/v6/forward';
const MAPBOX_TIMEOUT_MS = 5000;

export function geocodeProviderName(): 'mapbox' | 'offline' {
  return env.MAPBOX_ACCESS_TOKEN ? 'mapbox' : 'offline';
}

/** The cache key for an address: the same string the address book keys on. */
function addressKeyOf(address: AddressParts): string {
  return normalizeAddressKey(address);
}

export async function geocodeAddress(address: AddressParts): Promise<GeocodeAnswer> {
  const addressKey = addressKeyOf(address);
  const cached = await readGeocodeCache(addressKey);

  if (cached) {
    return {
      point:
        cached.outcome === 'FOUND' && cached.latitude !== null && cached.longitude !== null
          ? { latitude: cached.latitude, longitude: cached.longitude }
          : null,
      source: 'cache',
    };
  }

  const provider = geocodeProviderName();

  if (provider === 'offline') {
    const point = offlinePoint(addressKey);
    await writeGeocodeCache({ addressKey, outcome: 'FOUND', ...point, provider });

    return { point, source: 'offline' };
  }

  const answer = await askMapbox(address);

  // A provider that was down is not a house that does not exist, so the miss is
  // not written to the cache: caching it would keep the stop unplaceable for
  // the rest of the season on the strength of one bad afternoon.
  if (answer.failed) return { point: null, source: 'mapbox-error' };

  await writeGeocodeCache({
    addressKey,
    outcome: answer.point ? 'FOUND' : 'NOT_FOUND',
    latitude: answer.point?.latitude ?? null,
    longitude: answer.point?.longitude ?? null,
    provider,
  });

  return { point: answer.point, source: 'mapbox' };
}

/**
 * Straight-line distance in miles.
 *
 * A van drives streets, not great circles, so this is only ever used to say
 * "these two houses are near each other" — which is what the reroute suggestion
 * and the stop ordering both actually ask.
 */
const EARTH_RADIUS_MILES = 3958.8;

export function milesBetween(from: GeocodePoint, to: GeocodePoint): number {
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** `failed` separates "the provider did not answer" from "the provider said no". */
async function askMapbox(
  address: AddressParts,
): Promise<{ point: GeocodePoint | null; failed: boolean }> {
  const query = new URLSearchParams({
    access_token: env.MAPBOX_ACCESS_TOKEN ?? '',
    address_line1: address.line1,
    place: address.city,
    region: address.state,
    postcode: address.postalCode,
    country: address.country || 'US',
    limit: '1',
  });

  try {
    const response = await fetch(`${MAPBOX_ENDPOINT}?${query.toString()}`, {
      signal: AbortSignal.timeout(MAPBOX_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.warn(`Mapbox geocoding answered ${response.status} for ${address.postalCode}`);
      return { point: null, failed: true };
    }

    const body = (await response.json()) as {
      features?: { geometry?: { coordinates?: [number, number] } }[];
    };

    const coordinates = body.features?.[0]?.geometry?.coordinates;
    if (!coordinates || coordinates.length !== 2) return { point: null, failed: false };

    // Mapbox answers longitude first, which is the wrong way round for everyone
    // who has ever read a road atlas, so it is swapped here and nowhere else.
    return { point: { longitude: coordinates[0], latitude: coordinates[1] }, failed: false };
  } catch (error) {
    // A geocoder that is down must not stop a route being built: the stop keeps
    // null coordinates, the screen says which stops could not be placed, and the
    // manager orders those by hand. It is logged, because a season where nothing
    // geocodes is a broken token, not two hundred bad addresses.
    console.warn(
      `Mapbox geocoding failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
    return { point: null, failed: true };
  }
}

/**
 * Offline points, derived from the address key so the same house always lands in
 * the same place. Anchored on Lakewood with a spread of about a mile, so houses
 * on one street sit close enough for the half-mile reroute rule to fire.
 */
const OFFLINE_ANCHOR = { latitude: 40.0959, longitude: -74.2179 };
const OFFLINE_SPREAD_DEGREES = 0.02;

function offlinePoint(addressKey: string): GeocodePoint {
  const digest = createHash('sha256').update(addressKey).digest();

  return {
    latitude: OFFLINE_ANCHOR.latitude + fraction(digest[0], digest[1]) * OFFLINE_SPREAD_DEGREES,
    longitude: OFFLINE_ANCHOR.longitude + fraction(digest[2], digest[3]) * OFFLINE_SPREAD_DEGREES,
  };
}

/** Two bytes to a number in [-1, 1). */
function fraction(high: number, low: number): number {
  return ((high * 256 + low) / 32768) - 1;
}
