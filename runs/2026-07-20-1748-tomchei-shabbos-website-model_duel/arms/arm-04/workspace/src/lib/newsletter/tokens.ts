import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../env';

/**
 * Unsubscribe links have to work from an email client with no session, so the
 * link itself carries the proof (R-123). The token is signed, not encrypted:
 * anyone can read which subscriber it names, and nobody can change it.
 *
 * The signature covers a purpose string as well as the payload, so a session
 * cookie signed with the same key can never be pasted in as an unsubscribe
 * token, and this token can never be pasted in as a session.
 */
const PURPOSE = 'newsletter.unsubscribe.v1';

/**
 * A month. Long enough that an old newsletter still unsubscribes, short enough
 * that a link leaked from an inbox archive stops working.
 */
export const UNSUBSCRIBE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type UnsubscribeTokenCheck =
  | { valid: true; subscriberId: string }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function createUnsubscribeToken(subscriberId: string, now: Date = new Date()): string {
  const body = Buffer.from(
    JSON.stringify({ sub: subscriberId, exp: now.getTime() + UNSUBSCRIBE_TOKEN_TTL_MS }),
    'utf8',
  ).toString('base64url');

  return `${body}.${sign(body)}`;
}

export function readUnsubscribeToken(
  token: string | undefined,
  now: Date = new Date(),
): UnsubscribeTokenCheck {
  if (!token) return { valid: false, reason: 'malformed' };

  const separator = token.lastIndexOf('.');
  if (separator <= 0) return { valid: false, reason: 'malformed' };

  const body = token.slice(0, separator);
  if (!signaturesMatch(sign(body), token.slice(separator + 1))) {
    return { valid: false, reason: 'bad_signature' };
  }

  // Only parsed after the signature holds, so malformed JSON here is our bug
  // rather than something a caller can trigger.
  const payload = parsePayload(body);
  if (!payload) return { valid: false, reason: 'malformed' };
  if (payload.exp <= now.getTime()) return { valid: false, reason: 'expired' };

  return { valid: true, subscriberId: payload.sub };
}

export const UNSUBSCRIBE_TOKEN_MESSAGES: Record<
  Exclude<UnsubscribeTokenCheck, { valid: true }>['reason'],
  string
> = {
  malformed: 'That unsubscribe link is not readable. Use the link from a recent email.',
  bad_signature: 'That unsubscribe link has been altered, so it cannot be used.',
  expired: 'That unsubscribe link has expired. Use the link from a recent email.',
};

function parsePayload(body: string): { sub: string; exp: number } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;

    const { sub, exp } = parsed as { sub?: unknown; exp?: unknown };
    return typeof sub === 'string' && typeof exp === 'number' ? { sub, exp } : null;
  } catch {
    return null;
  }
}

function sign(body: string): string {
  return createHmac('sha256', env.AUTH_SESSION_SECRET).update(`${PURPOSE}.${body}`).digest('base64url');
}

function signaturesMatch(expected: string, received: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  if (expectedBytes.length !== receivedBytes.length) return false;
  return timingSafeEqual(expectedBytes, receivedBytes);
}
