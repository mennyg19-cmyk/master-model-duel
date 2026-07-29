// Geo helpers for the P9 route engine. Pure functions — the distance law
// (0.5-mile reroute suggestion, G-023) and the street-cluster fallback both
// live here so the unit suite pins them without a DB.

export interface GeoPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_MILES = 3958.8;

export function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

// G-023 "same street cluster": compare street lines without the house number
// ("123 Main Street" and "480 Main St" are the same run for a driver).
export function streetKey(line1: string): string {
  return line1
    .trim()
    .toLowerCase()
    .replace(/^\d+[a-zA-Z]?\s+/, "")
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\s+/g, " ");
}

// Geocode-cache key — the same normalized shape the P8 label path uses, so a
// destination geocoded for a label never refetches for a route.
export function normalizedAddressKey(source: {
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}): string {
  return [source.line1, source.line2 ?? "", source.city, source.region, source.postalCode, source.country]
    .map((part) => part.trim().toLowerCase())
    .join("|");
}

export function oneLineAddress(source: {
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postalCode: string;
}): string {
  return [source.line1, source.line2, `${source.city}, ${source.region} ${source.postalCode}`]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(", ");
}

// Google Maps universal URL — opens turn-by-turn directions to the address on
// any phone, no API key required (G-030).
export function googleMapsDirectionsUrl(source: {
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postalCode: string;
}): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(oneLineAddress(source))}`;
}
