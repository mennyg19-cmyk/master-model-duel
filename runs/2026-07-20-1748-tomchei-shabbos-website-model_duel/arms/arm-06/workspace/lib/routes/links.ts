import { createHash, randomBytes } from "node:crypto";
import { DriverRouteLink } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AuditContextLike, recordAudit } from "@/lib/audit";
import { env } from "@/lib/env";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { hmacSha256, safeEqual } from "@/lib/hmac";
import { writeRouteEvent } from "@/lib/routes/events";

// UR-004/UR-015/G-025: the driver magic link. Unguessable (256-bit token,
// only the SHA-256 hash is stored — the raw token exists in exactly one
// server response), scoped to one route's stops, dead on route completion or
// hard expiry, optional manager-texted 4-digit PIN with DB-side throttling.

export const LINK_TTL_MS = 72 * 60 * 60 * 1000;
export const PIN_MAX_FAILURES = 5;
export const PIN_LOCK_MS = 10 * 60 * 1000;
export const DRIVER_PIN_COOKIE = "drive_pin";

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
    include: { link: true, stops: { select: { id: true } } },
  });
  if (!route) throw new NotFoundError("DeliveryRoute", input.routeId);
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

// Throttled PIN verify. The lock lands on the fifth failure and the counter
// resets on success — a forwarded link without the PIN burns its attempts
// fast, and the manager can always rotate.
export async function checkPin(linkId: string, pin: string): Promise<PinCheck> {
  const link = await prisma.driverRouteLink.findUnique({ where: { id: linkId } });
  if (!link || !link.pinHash) return { outcome: "ok" };
  const now = new Date();
  if (link.pinLockedUntil && link.pinLockedUntil > now) {
    return { outcome: "locked", retryAt: link.pinLockedUntil };
  }
  if (!safeEqual(hashPin(link.routeId, pin), link.pinHash)) {
    const failures = link.pinFailures + 1;
    const locksNow = failures >= PIN_MAX_FAILURES;
    await prisma.driverRouteLink.update({
      where: { id: link.id },
      data: {
        pinFailures: locksNow ? 0 : failures,
        ...(locksNow ? { pinLockedUntil: new Date(now.getTime() + PIN_LOCK_MS) } : {}),
      },
    });
    return locksNow
      ? { outcome: "locked", retryAt: new Date(now.getTime() + PIN_LOCK_MS) }
      : { outcome: "failed", attemptsLeft: PIN_MAX_FAILURES - failures };
  }
  if (link.pinFailures > 0 || link.pinLockedUntil !== null) {
    await prisma.driverRouteLink.update({ where: { id: link.id }, data: { pinFailures: 0, pinLockedUntil: null } });
  }
  return { outcome: "ok" };
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
