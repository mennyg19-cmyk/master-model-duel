import 'server-only';

import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

import type { DriverRouteLink } from '@prisma/client';

import { recordAudit, type AuditActor } from '../audit';
import { failure, ok, type Result } from '../core/result';
import { db } from '../db';
import { runInTransaction } from '../transaction';

/**
 * The driver's key (UR-004, UR-015, G-025).
 *
 * A volunteer with a van is not a staff account and must not become one. They
 * get one URL that reaches one route: no admin, no other route, no customer
 * list. Three things make that safe to hand out over WhatsApp:
 *
 * 1. **The token is 32 random bytes** and the database keeps only its SHA-256,
 *    the same way a guest draft token is kept. A leaked backup is not a set of
 *    working keys.
 * 2. **The PIN is on unless the manager takes it off, hashed and throttled.**
 *    The URL alone reaches every household's name, address and phone, so it is
 *    not allowed to be the only credential by default. Four digits is guessable
 *    in an afternoon, so the lockout is the real defence and the hash only stops
 *    the office from reading it back.
 * 3. **The link dies when the route is done**, with a short grace so the last
 *    tap can be reloaded.
 */
export const LINK_NOT_FOUND = 'driver_link_not_found';
export const LINK_EXPIRED = 'driver_link_expired';
export const PIN_REQUIRED = 'driver_pin_required';
export const PIN_WRONG = 'driver_pin_wrong';
export const PIN_LOCKED = 'driver_pin_locked';

const TOKEN_BYTES = 32;
const SCRYPT_KEY_LENGTH = 32;
const MAX_PIN_ATTEMPTS = 5;
const FIRST_LOCKOUT_MS = 10 * 60 * 1000;
const MAX_LOCKOUT_MS = 12 * 60 * 60 * 1000;
const DEFAULT_LIFETIME_MS = 3 * 24 * 60 * 60 * 1000;

export type IssuedLink = { linkId: string; token: string; pin: string | null; expiresAt: Date };

export async function issueRouteLink(
  actor: AuditActor,
  input: { routeId: string; seasonId: string; withPin: boolean },
): Promise<Result<IssuedLink>> {
  const route = await db.deliveryRoute.findFirst({
    where: { id: input.routeId, seasonId: input.seasonId },
  });

  if (!route) return failure(LINK_NOT_FOUND, 'That route is not one of this season\u2019s.');
  if (route.status === 'COMPLETED') {
    return failure(LINK_EXPIRED, 'This route is finished, so there is nothing left to hand a driver.');
  }

  const retiring = await db.driverRouteLink.findMany({
    where: { routeId: route.id, revokedAt: null },
    select: { id: true },
  });

  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const pin = input.withPin ? randomInt(0, 10_000).toString().padStart(4, '0') : null;
  const salt = pin ? randomBytes(16).toString('base64') : null;
  const expiresAt = new Date(Date.now() + DEFAULT_LIFETIME_MS);

  const issued = await runInTransaction(async (tx) => {
    // One live link per route: issuing a new one retires the old, so a link that
    // went to the wrong phone stops working the moment the manager reissues.
    // A silent retirement is still a revocation, so it leaves the same row
    // `revokeRouteLink` writes — otherwise the trail says a link stopped working
    // and never says who stopped it.
    await tx.driverRouteLink.updateMany({
      where: { routeId: route.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    for (const retired of retiring) {
      await recordAudit(
        actor,
        {
          action: 'route.link_revoked',
          entityType: 'DeliveryRoute',
          entityId: route.id,
          detail: { linkId: retired.id },
        },
        tx,
      );
    }

    const link = await tx.driverRouteLink.create({
      data: {
        routeId: route.id,
        tokenHash: hashToken(token),
        pinHash: pin && salt ? hashPin(pin, salt) : null,
        pinSalt: salt,
        expiresAt,
        createdByStaffId: actor?.actor.id ?? null,
      },
    });

    await recordAudit(
      actor,
      {
        action: 'route.link_issued',
        entityType: 'DeliveryRoute',
        entityId: route.id,
        detail: { linkId: link.id, hasPin: pin !== null, expiresAt: expiresAt.toISOString() },
      },
      tx,
    );

    return link.id;
  });

  if (!issued.ok) return issued;

  return ok({ linkId: issued.value, token, pin, expiresAt });
}

export async function revokeRouteLink(
  actor: AuditActor,
  input: { routeId: string; seasonId: string },
): Promise<Result<{ revoked: number }>> {
  const route = await db.deliveryRoute.findFirst({
    where: { id: input.routeId, seasonId: input.seasonId },
    include: { driverLinks: { where: { revokedAt: null } } },
  });

  if (!route) return failure(LINK_NOT_FOUND, 'That route is not one of this season\u2019s.');
  if (route.driverLinks.length === 0) {
    return failure(LINK_NOT_FOUND, 'There is no live link on this route to take back.');
  }

  await db.driverRouteLink.updateMany({
    where: { routeId: route.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  for (const link of route.driverLinks) {
    await recordAudit(actor, {
      action: 'route.link_revoked',
      entityType: 'DeliveryRoute',
      entityId: route.id,
      detail: { linkId: link.id },
    });
  }

  return ok({ revoked: route.driverLinks.length });
}

/**
 * Finds the link a token belongs to.
 *
 * The lookup is by hash, so an expired or revoked link and a token nobody ever
 * issued are answered the same way: there is nothing here. Anything else lets a
 * stranger tell a real route id from a guess.
 */
export async function findLinkByToken(token: string): Promise<DriverRouteLink | null> {
  if (token.trim() === '') return null;

  const link = await db.driverRouteLink.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!link) return null;

  return link.revokedAt === null && link.expiresAt > new Date() ? link : null;
}

export function linkNeedsPin(link: DriverRouteLink): boolean {
  return link.pinHash !== null;
}

/**
 * Checks a PIN and counts the wrong ones.
 *
 * The lockout is per link rather than per browser: a guesser who clears cookies
 * or moves to another phone is the whole reason four digits needs throttling.
 * A correct PIN clears the counter, so a driver who fat-fingers it twice on a
 * cold morning is not locked out an hour later.
 *
 * The counter is **not** cleared by the lock. Ten thousand PINs against a
 * three-day link is only safe if waiting out the lockout costs more each time:
 * five wrong guesses buys ten minutes, the next five twenty, and so on to
 * twelve hours. Resetting to zero on each lock would hand an attacker five
 * fresh guesses every ten minutes for three days, which is most of the keyspace.
 */
export async function checkRoutePin(
  linkId: string,
  pin: string,
): Promise<Result<{ linkId: string }>> {
  const link = await db.driverRouteLink.findUnique({ where: { id: linkId } });

  if (!link || link.revokedAt !== null || link.expiresAt <= new Date()) {
    return failure(LINK_EXPIRED, 'This link is no longer live. Ask the office for a new one.');
  }

  if (link.lockedUntil && link.lockedUntil > new Date()) {
    return failure(
      PIN_LOCKED,
      'Too many wrong PINs. This link is locked for a few minutes — ring the office.',
    );
  }

  if (!link.pinHash || !link.pinSalt) return ok({ linkId: link.id });

  if (!pinMatches(pin, link.pinSalt, link.pinHash)) {
    const attempts = link.failedPinAttempts + 1;
    const lockouts = Math.floor(attempts / MAX_PIN_ATTEMPTS);
    const locked = attempts % MAX_PIN_ATTEMPTS === 0;

    await db.driverRouteLink.update({
      where: { id: link.id },
      data: {
        failedPinAttempts: attempts,
        lockedUntil: locked ? new Date(Date.now() + lockoutMs(lockouts)) : link.lockedUntil,
      },
    });

    return failure(
      locked ? PIN_LOCKED : PIN_WRONG,
      locked
        ? 'Too many wrong PINs. This link is locked, and locked for longer each time — ring the office.'
        : `That PIN is not right. ${MAX_PIN_ATTEMPTS - (attempts % MAX_PIN_ATTEMPTS)} more tries before the link locks.`,
    );
  }

  await db.driverRouteLink.update({
    where: { id: link.id },
    data: { failedPinAttempts: 0, lockedUntil: null, lastUsedAt: new Date() },
  });

  return ok({ linkId: link.id });
}

export async function touchLink(linkId: string): Promise<void> {
  await db.driverRouteLink.update({ where: { id: linkId }, data: { lastUsedAt: new Date() } });
}

/** Ten minutes, then twenty, then forty, up to half a day. */
function lockoutMs(lockouts: number): number {
  return Math.min(FIRST_LOCKOUT_MS * 2 ** (lockouts - 1), MAX_LOCKOUT_MS);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

function hashPin(pin: string, salt: string): string {
  return scryptSync(pin, salt, SCRYPT_KEY_LENGTH).toString('base64');
}

function pinMatches(candidate: string, salt: string, expected: string): boolean {
  const expectedBytes = Buffer.from(expected, 'base64');
  const candidateBytes = scryptSync(candidate, salt, SCRYPT_KEY_LENGTH);

  return (
    expectedBytes.length === candidateBytes.length && timingSafeEqual(expectedBytes, candidateBytes)
  );
}
