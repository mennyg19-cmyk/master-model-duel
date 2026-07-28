import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { addressValidateRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { getSetting } from "@/lib/settings";
import { isDeliverable } from "@/lib/storefront/delivery";
import { addressDedupeKey, addressInputSchema, normalizeAddressInput } from "@/lib/customers/addresses";
import { geocodeAddress } from "@/lib/customers/geocode";

// R-025: server-side address validation. Format (zod) + normalization +
// geocode (provider seam) + a live deliverability flag against the delivery
// ZIP allowlist. Rate-limited like the other unauthenticated probes.
export async function POST(request: Request) {
  if (!addressValidateRateLimit(clientIp(request.headers) ?? "unknown")) {
    return NextResponse.json({ error: "Too many validation attempts" }, { status: 429 });
  }

  const parsed = await parseBody(request, addressInputSchema, "Address is invalid");
  if (!parsed.ok) return parsed.response;

  const normalized = normalizeAddressInput(parsed.data);
  const key = addressDedupeKey(normalized);
  const point = await geocodeAddress(key, { persist: false });
  const deliveryZips = (await getSetting("shipping.deliveryZips")) ?? [];

  return NextResponse.json({
    ok: true,
    normalized,
    geocode: { lat: point.lat, lng: point.lng },
    deliverable: isDeliverable(deliveryZips, normalized.postalCode),
  });
}
