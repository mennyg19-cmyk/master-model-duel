import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import type { AddressParts } from "@/lib/address/normalize";

const TTL_MS = 1000 * 60 * 60 * 24 * 30;

export type GeocodeResult = {
  latitude: number | null;
  longitude: number | null;
  geocodeStatus: "ok" | "failed" | "approx";
  geocodedAt: Date;
};

function queryKey(input: AddressParts): string {
  const raw = [
    input.line1.trim().toLowerCase(),
    (input.line2 ?? "").trim().toLowerCase(),
    input.city.trim().toLowerCase(),
    input.state.trim().toUpperCase(),
    input.postalCode.trim(),
    (input.country ?? "US").trim().toUpperCase(),
  ].join("|");
  return createHash("sha256").update(raw).digest("hex");
}

/** Deterministic offline geocoder (no external provider in P4). */
function fakeGeocode(input: AddressParts): GeocodeResult {
  const zip = Number(input.postalCode.slice(0, 5));
  if (!Number.isFinite(zip) || zip < 501) {
    return {
      latitude: null,
      longitude: null,
      geocodeStatus: "failed",
      geocodedAt: new Date(),
    };
  }
  // Rough US centroid from ZIP digits — stable for smoke assertions.
  const latitude = 24 + (zip % 2500) / 100;
  const longitude = -66 - (zip % 4800) / 100;
  return {
    latitude: Math.round(latitude * 1000) / 1000,
    longitude: Math.round(longitude * 1000) / 1000,
    geocodeStatus: "ok",
    geocodedAt: new Date(),
  };
}

export async function geocodeAddress(input: AddressParts): Promise<GeocodeResult> {
  const key = queryKey(input);
  const cached = await db.geocodeCache.findUnique({ where: { queryKey: key } });
  if (cached && cached.expiresAt > new Date()) {
    return {
      latitude: cached.latitude,
      longitude: cached.longitude,
      geocodeStatus: cached.success ? "ok" : "failed",
      geocodedAt: cached.updatedAt,
    };
  }

  const result = fakeGeocode(input);
  await db.geocodeCache.upsert({
    where: { queryKey: key },
    create: {
      queryKey: key,
      latitude: result.latitude,
      longitude: result.longitude,
      success: result.geocodeStatus === "ok",
      provider: "local-deterministic",
      expiresAt: new Date(Date.now() + TTL_MS),
    },
    update: {
      latitude: result.latitude,
      longitude: result.longitude,
      success: result.geocodeStatus === "ok",
      provider: "local-deterministic",
      expiresAt: new Date(Date.now() + TTL_MS),
    },
  });
  return result;
}

const SUGGESTIONS: Array<AddressParts & { label: string }> = [
  {
    label: "100 Main St, Brooklyn, NY 11218",
    recipientName: "",
    line1: "100 Main St",
    city: "Brooklyn",
    state: "NY",
    postalCode: "11218",
    country: "US",
  },
  {
    label: "200 Ocean Pkwy, Brooklyn, NY 11218",
    recipientName: "",
    line1: "200 Ocean Pkwy",
    city: "Brooklyn",
    state: "NY",
    postalCode: "11218",
    country: "US",
  },
  {
    label: "500 Community Ave, Brooklyn, NY 11218",
    recipientName: "",
    line1: "500 Community Ave",
    city: "Brooklyn",
    state: "NY",
    postalCode: "11218",
    country: "US",
  },
  {
    label: "18 Avenue J, Brooklyn, NY 11230",
    recipientName: "",
    line1: "18 Avenue J",
    city: "Brooklyn",
    state: "NY",
    postalCode: "11230",
    country: "US",
  },
];

export function autocompleteAddresses(query: string, limit = 5) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return SUGGESTIONS.filter(
    (s) =>
      s.label.toLowerCase().includes(q) ||
      s.line1.toLowerCase().includes(q) ||
      s.postalCode.includes(q),
  ).slice(0, limit);
}
