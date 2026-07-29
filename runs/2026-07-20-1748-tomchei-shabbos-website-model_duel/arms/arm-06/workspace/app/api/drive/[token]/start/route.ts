import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { startRoute } from "@/lib/routes/lifecycle";
import { DRIVER_PIN_COOKIE, loadLinkByToken, verifyPinCookie } from "@/lib/routes/links";
import { mapDomainError } from "@/lib/http-errors";

export const dynamic = "force-dynamic";

// G-030: driver taps "start route". Fires the day-of notification — exactly
// one email + one SMS per affected CUSTOMER, ever; a re-tap (second device,
// retry after a crash) returns alreadyStarted and sends nothing.
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
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
    const result = await startRoute({ routeId: link.route.id, linkId: link.id });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
