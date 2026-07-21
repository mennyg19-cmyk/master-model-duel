import { geocodeAddress } from "@/lib/address/geocode";

const EARTH_MI = 3958.8;

export function haversineMiles(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function googleMapsDeepLink(addr: {
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
}): string {
  const parts = [
    addr.addressLine1,
    addr.addressLine2,
    addr.city,
    addr.state,
    addr.postalCode,
    addr.country ?? "US",
  ]
    .filter(Boolean)
    .join(", ");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(parts)}`;
}

export async function geocodePackageAddress(pkg: {
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string | null;
  recipientName?: string;
}) {
  return geocodeAddress({
    recipientName: pkg.recipientName ?? "",
    line1: pkg.addressLine1,
    line2: pkg.addressLine2 ?? undefined,
    city: pkg.city,
    state: pkg.state,
    postalCode: pkg.postalCode,
    country: pkg.country ?? "US",
  });
}

export function sameStreetCluster(
  a: { addressLine1: string },
  b: { addressLine1: string },
): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|place|pl)\b/g, "")
      .replace(/[^a-z0-9]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const na = norm(a.addressLine1);
  const nb = norm(b.addressLine1);
  if (!na || !nb) return false;
  // Drop house number — compare street tokens.
  const streetA = na.replace(/^\d+\s+/, "");
  const streetB = nb.replace(/^\d+\s+/, "");
  return streetA.length > 2 && streetA === streetB;
}
