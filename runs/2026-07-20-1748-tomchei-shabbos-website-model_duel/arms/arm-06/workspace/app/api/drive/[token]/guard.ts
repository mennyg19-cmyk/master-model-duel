import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DriverRouteLink } from "@prisma/client";
import { clearStalePinFailures, DRIVER_PIN_COOKIE, loadLinkByToken, verifyPinCookie } from "@/lib/routes/links";

// m23: one guard for every /api/drive/[token]/* verb — load the link by its
// URL token, map state to 404/410 with the same message everywhere, then
// demand the PIN cookie when the link is PIN-protected. Either the active
// link comes back, or the exact response to return.
export type DriveLink = DriverRouteLink & { route: { id: string; status: string } };

export async function requireActiveLink(rawToken: string): Promise<{ link: DriveLink } | { response: NextResponse }> {
  const { state, link } = await loadLinkByToken(rawToken);
  if (state !== "active" || !link) {
    const status = state === "invalid" ? 404 : 410;
    const error =
      state === "completed" ? "Route completed — this link is closed" : state === "expired" ? "Link expired" : "Unknown link";
    return { response: NextResponse.json({ error, state }, { status }) };
  }
  if (link.pinHash) {
    const jar = await cookies();
    if (!(await verifyPinCookie(jar.get(DRIVER_PIN_COOKIE)?.value, link.id))) {
      return { response: NextResponse.json({ error: "PIN required", state: "pin_required" }, { status: 403 }) };
    }
    // m16: the PIN holder is provably present — stale failure counters from
    // an earlier forwarded-link attack clear (the lifetime lock count stays).
    await clearStalePinFailures(link);
  }
  return { link };
}
