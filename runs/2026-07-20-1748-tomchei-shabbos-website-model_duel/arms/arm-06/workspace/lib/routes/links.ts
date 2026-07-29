import { createHash, randomBytes } from "node:crypto";
import { DriverRouteLink } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AuditContextLike, recordAudit } from "@/lib/audit";
import { MILLIS_PER_HOUR, MILLIS_PER_MINUTE } from "@/lib/dates";
import { env } from "@/lib/env";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { hmacSha256, safeEqual } from "@/lib/hmac";
import { writeRouteEvent } from "@/lib/routes/events";

// UR-004/UR-015/G-025: the driver magic link. Unguessable (256-bit token,
// only the SHA-256 hash is stored — the raw token exists in exactly one
// server response), scoped to one route's stops, dead on route completion or
// hard expiry, optional manager-texted 4-digit PIN with DB-side throttling.

export const LINK_TTL_MS = 72 * MILLIS_PER_HOUR;
export const PIN_MAX_FAILURES = 5;
export const PIN_LOCK_MS = 10 * MILLIS_PER_MINUTE;
// M1: a flat 5-failures-then-10-minutes cadence budgets 2 160 guesses over
// the 72h link TTL (~21.6% of the 4-digit space). Instead the lock ESCALATES
// per lifetime lock (pinLockCount never resets on a correct PIN): 10m, 20m,
// 40m … capped at 12h, and after PIN_MAX_LOCKS the PIN dies until the manager
// rotates the link. Budget over 72h: ~50 guesses ≈ 0.5% of the space.
export const PIN_LOCK_MAX_MS = 12 * MILLIS_PER_HOUR;
export const PIN_MAX_LOCKS = 10;
export const DRIVER_PIN_COOKIE = "drive_pin";

export function pinLockDurationMs(lockCount: number): number {
  return Math.min(PIN_LOCK_MS * 2 ** Math.max(0, lockCount - 1), PIN_LOCK_MAX_MS);
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashLinkToken(rawToken: string): string {
  return sha256Hex(rawToken);
}

function hashPin(routeId: string, pin: string): string {
  return sha256Hex(`drive-pin:${routeId}:${pin}`);
}

export function isPinFormat(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export interface CreatedLink {
  linkId: string;
  rawUrl: string;
  expiresAt: Date;
  rotated: boolean;
}

// Create (or rotate) the route's link. The raw URL is returned ONCE and never
// stored; rotating kills the previous token immediately.
export async function createDriverLink(input: {
  routeId: string;
  pin?: string | null;
  ctx: AuditContextLike;
}): Promise<CreatedLink> {
  if (input.pin !== undefined && input.pin !== null && !isPinFormat(input.pin)) {
    throw new DomainRuleError(`Driver PIN must be exactly 4 digits; got "${input.pin}"`);
  }
  const route = await prisma.deliveryRoute.findUnique({
    where: { id: input.routeId },
    include: { link: true, stops: { select: { id: true } }, season: { select: { status: true } } },
  });
  if (!route) throw new NotFoundError("DeliveryRoute", input.routeId);
  // m4: route-side season scoping — a stale route from a prior season gets no
  // new driver link, even while it sits un-COMPLETED.
  if (route.season.status !== "OPEN") {
    throw new DomainRuleError(`Route "${route.name}" belongs to a closed season; expected an open-season route for a driver link`);
  }
  if (route.stops.length === 0) {
    throw new DomainRuleError(`Route ${input.routeId} has no stops; expected stops before handing a driver the link`);
  }
  if (route.status === "COMPLETED") {
    throw new DomainRuleError(`Route ${input.routeId} is completed; a finished run gets no new driver link`);
  }

  const rawToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + LINK_TTL_MS);
  const rotated = route.link !== null;

  const link = await prisma.$transaction(async (tx) => {
    if (route.link) await tx.driverRouteLink.delete({ where: { id: route.link.id } });
    const created = await tx.driverRouteLink.create({
      data: {
        routeId: route.id,
        tokenHash: hashLinkToken(rawToken),
        pinHash: input.pin ? hashPin(route.id, input.pin) : null,
        expiresAt,
      },
    });
    await writeRouteEvent(tx, route.id, rotated ? "link_rotated" : "link_created", {
      linkId: created.id,
      actorId: input.ctx.staff.id,
      metadata: { hasPin: input.pin != null, expiresAt: expiresAt.toISOString() },
    });
    return created;
  });

  await recordAudit({
    ctx: input.ctx,
    action: "route_link_create",
    targetType: "DeliveryRoute",
    targetId: route.id,
    metadata: { linkId: link.id, rotated, hasPin: input.pin != null, expiresAt: expiresAt.toISOString() },
  });
  return { linkId: link.id, rawUrl: `/drive/${rawToken}`, expiresAt, rotated };
}

export type LinkState = "active" | "invalid" | "expired" | "completed";

export interface LoadedLink {
  state: LinkState;
  link: (DriverRouteLink & { route: { id: string; status: string } }) | null;
}

export async function loadLinkByToken(rawToken: string): Promise<LoadedLink> {
  const link = await prisma.driverRouteLink.findUnique({
    where: { tokenHash: hashLinkToken(rawToken) },
    include: { route: { select: { id: true, status: true } } },
  });
  if (!link) return { state: "invalid", link: null };
  if (link.route.status === "COMPLETED") return { state: "completed", link };
  if (link.expiresAt <= new Date()) return { state: "expired", link };
  return { state: "active", link };
}

export type PinCheck =
  | { outcome: "ok" }
  | { outcome: "locked"; retryAt: Date }
  | { outcome: "failed"; attemptsLeft: number };

// Throttled PIN verify with escalating lockout (M1): the fifth failure locks,
// each successive lock doubles the window (10m → 20m → 40m … capped 12h), and
// past PIN_MAX_LOCKS the PIN is dead until rotation. pinLockCount never
// resets on a correct PIN, so a forwarded link cannot reset the escalation by
// riding a legitimate session. The manager can always rotate.
export async function checkPin(linkId: string, pin: string): Promise<PinCheck> {
  const link = await prisma.driverRouteLink.findUnique({ where: { id: linkId } });
  if (!link || !link.pinHash) return { outcome: "ok" };
  const now = new Date();
  if (link.pinLockedUntil && link.pinLockedUntil > now) {
    return { outcome: "locked", retryAt: link.pinLockedUntil };
  }
  if (!safeEqual(hashPin(link.routeId, pin), link.pinHash)) {
    const failures = link.pinFailures + 1;
    if (failures < PIN_MAX_FAILURES) {
      await prisma.driverRouteLink.update({ where: { id: link.id }, data: { pinFailures: failures } });
      return { outcome: "failed", attemptsLeft: PIN_MAX_FAILURES - failures };
    }
    const lockCount = link.pinLockCount + 1;
    // Past the cap the PIN is permanently locked — the lock simply outlives
    // the link itself; only a manager rotation revives driver access.
    const lockedUntil =
      lockCount > PIN_MAX_LOCKS ? link.expiresAt : new Date(now.getTime() + pinLockDurationMs(lockCount));
    await prisma.driverRouteLink.update({
      where: { id: link.id },
      data: { pinFailures: 0, pinLockCount: lockCount, pinLockedUntil: lockedUntil },
    });
    return { outcome: "locked", retryAt: lockedUntil };
  }
  if (link.pinFailures > 0 || link.pinLockedUntil !== null) {
    await prisma.driverRouteLink.update({ where: { id: link.id }, data: { pinFailures: 0, pinLockedUntil: null } });
  }
  return { outcome: "ok" };
}

// m16: a valid PIN-cookie session proves the PIN holder is present — stale
// failure counters from an earlier forwarded-link attack clear once the lock
// window passed. pinLockCount (M1's lifetime escalation) never clears, and
// only the cookie-verified path may call this: an attacker without the PIN
// can never reset the counters.
export async function clearStalePinFailures(link: DriverRouteLink): Promise<void> {
  const lockExpired = !link.pinLockedUntil || link.pinLockedUntil <= new Date();
  if (lockExpired && (link.pinFailures > 0 || link.pinLockedUntil !== null)) {
    await prisma.driverRouteLink.update({
      where: { id: link.id },
      data: { pinFailures: 0, pinLockedUntil: null },
    });
  }
}

// PIN cookie: HMAC over the link id + the link's own expiry, so the cookie
// can never outlive the link and is worthless for any other route. The
// cookie is only the PIN pass — the unguessable URL token remains the
// primary credential and every mutation re-loads the link.
export async function issuePinCookie(linkId: string, expiresAt: Date): Promise<string> {
  const expiresMs = expiresAt.getTime();
  const signature = await hmacSha256(env.AUTH_SECRET, `drive.${linkId}.${expiresMs}`);
  return `${linkId}.${expiresMs}.${signature}`;
}

export async function verifyPinCookie(rawCookie: string | undefined, linkId: string): Promise<boolean> {
  if (!rawCookie) return false;
  const [cookieLinkId, expiresMsRaw, signature] = rawCookie.split(".");
  if (!cookieLinkId || !expiresMsRaw || !signature || cookieLinkId !== linkId) return false;
  const expiresMs = Number(expiresMsRaw);
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) return false;
  const expected = await hmacSha256(env.AUTH_SECRET, `drive.${cookieLinkId}.${expiresMsRaw}`);
  return safeEqual(signature, expected);
}
