import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/parse-body";
import { deliveryCheckRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { getSetting } from "@/lib/settings";
import { isDeliverable } from "@/lib/storefront/delivery";

export const dynamic = "force-dynamic";

const checkSchema = z.object({
  postalCode: z.string().regex(/^\d{5}$/, "ZIPs are 5 digits"),
});

// G-014: live delivery-area check. Reads the allowlist per request, so a
// settings-hub edit is visible on the very next call. Rate-limited per client
// IP — an uncapped yes/no oracle over all 100k ZIPs would enumerate the
// allowlist.
export async function POST(request: Request) {
  if (!deliveryCheckRateLimit(clientIp(request.headers) ?? "unknown")) {
    return NextResponse.json({ error: "Too many checks — try again in a minute" }, { status: 429 });
  }

  const parsed = await parseBody(request, checkSchema, "A 5-digit ZIP is required");
  if (!parsed.ok) return parsed.response;

  const deliveryZips = (await getSetting("shipping.deliveryZips")) ?? [];
  return NextResponse.json({ deliverable: isDeliverable(deliveryZips, parsed.data.postalCode) });
}
