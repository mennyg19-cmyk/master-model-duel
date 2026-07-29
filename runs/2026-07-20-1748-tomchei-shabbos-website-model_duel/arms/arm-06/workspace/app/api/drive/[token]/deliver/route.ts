import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { mapDomainError } from "@/lib/http-errors";
import { parseBody } from "@/lib/parse-body";
import { markStopDelivered } from "@/lib/routes/lifecycle";
import { DRIVER_PIN_COOKIE, loadLinkByToken, verifyPinCookie } from "@/lib/routes/links";

export const dynamic = "force-dynamic";

const deliverSchema = z.object({ stopId: z.string().min(1) });

// G-025/G-030: the Delivered tap via magic link. Atomic claim on
// deliveredAt IS NULL (double-tap safe), audits with the link id, advances
// the package to its terminal stage, completes the route on the last stop —
// which kills this link for any further use.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = await parseBody(request, deliverSchema, "A stop id is required");
  if (!parsed.ok) return parsed.response;

  const { state, link } = await loadLinkByToken(token);
  if (state !== "active" || !link) {
    const status = state === "invalid" ? 404 : 410;
    return NextResponse.json({ error: "Link is not active", state }, { status });
  }
  if (link.pinHash) {
    const jar = await cookies();
    if (!(await verifyPinCookie(jar.get(DRIVER_PIN_COOKIE)?.value, link.id))) {
      return NextResponse.json({ error: "PIN required", state: "pin_required" }, { status: 403 });
    }
  }

  try {
    const result = await markStopDelivered({ routeId: link.route.id, stopId: parsed.data.stopId, via: { linkId: link.id } });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
