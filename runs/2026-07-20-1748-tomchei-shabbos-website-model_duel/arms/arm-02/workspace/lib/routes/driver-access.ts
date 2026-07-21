import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { loadLinkByToken, pinCookieName, pinCookieValid } from "@/lib/routes/links";

// Resolves a magic-link token into the driver's working context: the link,
// its route, and whether this browser already passed the PIN gate. Used by
// both the /d/[token] page and the driver API routes so the scoping rule
// (this route's stops ONLY, R-116 replacement) lives in one place.

export type DriverAccess =
  | { ok: false; reason: "not_found" | "expired" }
  | { ok: false; reason: "pin_required"; linkId: string }
  | {
      ok: true;
      linkId: string;
      route: { id: string; seasonId: string; name: string; status: string; startedAt: Date | null };
    };

export async function resolveDriverAccess(token: string): Promise<DriverAccess> {
  const access = await loadLinkByToken(token);
  if (!access.ok) return { ok: false, reason: access.reason };

  if (access.link.pinHash) {
    const cookieStore = await cookies();
    const value = cookieStore.get(pinCookieName(access.link.id))?.value;
    if (!pinCookieValid(access.link.id, value)) {
      return { ok: false, reason: "pin_required", linkId: access.link.id };
    }
  }

  const route = await db.deliveryRoute.findUnique({
    where: { id: access.link.routeId },
    select: { id: true, seasonId: true, name: true, status: true, startedAt: true },
  });
  if (!route) return { ok: false, reason: "not_found" };
  return { ok: true, linkId: access.link.id, route };
}
