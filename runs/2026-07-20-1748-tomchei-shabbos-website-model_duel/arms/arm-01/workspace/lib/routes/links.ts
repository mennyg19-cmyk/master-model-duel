import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

// Driver magic links (UR-004, UR-015, G-025). The URL token is 32 random
// bytes, stored only as an HMAC hash (same posture as staff sessions — a
// leaked RouteLink table cannot be used to forge URLs). Optional 4-digit PIN
// with attempt lockout; PIN success is remembered in an httpOnly cookie whose
// value is an HMAC only the server can mint.

const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 15;
/** After the last stop is delivered the link stays usable this long (short grace). */
export const LINK_COMPLETION_GRACE_MINUTES = 30;

function hmac(input: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(input).digest("hex");
}

export function hashLinkToken(token: string): string {
  return hmac(`route-link|${token}`);
}

export function hashPin(linkId: string, pin: string): string {
  return hmac(`route-pin|${linkId}|${pin}`);
}

/** Cookie value proving this browser passed the link's PIN gate. */
export function pinCookieName(linkId: string): string {
  return `tomchei_route_${linkId}`;
}

export function pinCookieValue(linkId: string): string {
  return hmac(`route-pin-ok|${linkId}`);
}

export function pinCookieValid(linkId: string, value: string | undefined): boolean {
  if (!value) return false;
  const expected = Buffer.from(pinCookieValue(linkId));
  const actual = Buffer.from(value);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Create (or rotate) the route's magic link. Rotation revokes every earlier
 * link so a forwarded old URL dies the moment staff mint a new one.
 */
export async function createRouteLink(routeId: string, pin: string | null, staffId?: string) {
  const token = randomBytes(32).toString("base64url");
  // The PIN hash is keyed by the link id, so mint the id up front — the link
  // row is born WITH its pinHash in one insert. A PIN-protected link can never
  // exist, even transiently, without its PIN gate.
  const linkId = randomUUID();
  const link = await db.$transaction(async (tx) => {
    await tx.routeLink.updateMany({
      where: { routeId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return tx.routeLink.create({
      data: {
        id: linkId,
        routeId,
        tokenHash: hashLinkToken(token),
        pinHash: pin ? hashPin(linkId, pin) : null,
        createdByStaffId: staffId,
      },
    });
  });
  return { link, token, url: `${env.APP_URL}/d/${token}` };
}

export type LinkAccess =
  | { ok: true; link: { id: string; routeId: string; pinHash: string | null } }
  | { ok: false; reason: "not_found" | "expired" };

/** Resolve a URL token to its live link. Revoked or past-grace links are gone. */
export async function loadLinkByToken(token: string): Promise<LinkAccess> {
  const link = await db.routeLink.findUnique({
    where: { tokenHash: hashLinkToken(token) },
    select: { id: true, routeId: true, pinHash: true, revokedAt: true, expiresAt: true },
  });
  if (!link || link.revokedAt) return { ok: false, reason: "not_found" };
  if (link.expiresAt && link.expiresAt < new Date()) return { ok: false, reason: "expired" };
  return { ok: true, link: { id: link.id, routeId: link.routeId, pinHash: link.pinHash } };
}

export type PinCheck =
  | { ok: true }
  | { ok: false; locked: boolean; attemptsLeft: number; noPin?: boolean };

/** Throttled PIN check (UR-015): 5 wrong tries lock the link for 15 minutes. */
export async function verifyPin(linkId: string, pin: string): Promise<PinCheck> {
  const link = await db.routeLink.findUnique({
    where: { id: linkId },
    select: { pinHash: true, pinAttempts: true, pinLockedUntil: true },
  });
  // A link with no pinHash never passes the PIN gate — posting a PIN to a
  // no-PIN link must not mint a cookie or read as success.
  if (!link?.pinHash) return { ok: false, locked: false, attemptsLeft: 0, noPin: true };
  if (link.pinLockedUntil && link.pinLockedUntil > new Date()) {
    return { ok: false, locked: true, attemptsLeft: 0 };
  }

  const expected = Buffer.from(link.pinHash);
  const actual = Buffer.from(hashPin(linkId, pin));
  const correct = expected.length === actual.length && timingSafeEqual(expected, actual);
  if (correct) {
    await db.routeLink.update({
      where: { id: linkId },
      data: { pinAttempts: 0, pinLockedUntil: null },
    });
    return { ok: true };
  }

  const attempts = link.pinAttempts + 1;
  const locked = attempts >= PIN_MAX_ATTEMPTS;
  await db.routeLink.update({
    where: { id: linkId },
    data: {
      pinAttempts: locked ? 0 : attempts,
      pinLockedUntil: locked ? new Date(Date.now() + PIN_LOCK_MINUTES * 60_000) : null,
    },
  });
  return { ok: false, locked, attemptsLeft: locked ? 0 : PIN_MAX_ATTEMPTS - attempts };
}
