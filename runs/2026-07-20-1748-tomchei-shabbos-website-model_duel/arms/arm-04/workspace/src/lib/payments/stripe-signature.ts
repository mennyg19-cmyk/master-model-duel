import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { failure, ok, type Result } from '../core/result';

/**
 * Stripe's webhook signature scheme (R-125).
 *
 * The header looks like `t=1699999999,v1=<hex>,v1=<hex>` — more than one v1
 * while a signing secret is being rotated — and the signed string is the
 * timestamp, a dot, and the exact bytes of the body. Parsing the body first and
 * re-serializing it would change those bytes and fail every time, which is why
 * the route reads `request.text()`.
 */
export const SIGNATURE_HEADER = 'stripe-signature';

export const INVALID_SIGNATURE = 'invalid_webhook_signature';

/**
 * How old a webhook may be. A signature is valid forever without this, so a
 * copy of one request could be replayed at any point in the future; five
 * minutes is Stripe's own recommendation and leaves room for clock drift.
 */
const TOLERANCE_SECONDS = 300;

export function signStripePayload(payload: string, secret: string, timestampSeconds: number): string {
  return `t=${timestampSeconds},v1=${hmac(`${timestampSeconds}.${payload}`, secret)}`;
}

export function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Result<null> {
  if (!header) return failure(INVALID_SIGNATURE, 'This request carries no signature.');

  const parts = parseHeader(header);
  if (parts.timestamp === null || parts.signatures.length === 0) {
    return failure(INVALID_SIGNATURE, 'This signature is not in a form we can check.');
  }

  if (Math.abs(nowSeconds - parts.timestamp) > TOLERANCE_SECONDS) {
    return failure(INVALID_SIGNATURE, 'This signature is too old to accept.');
  }

  const expected = hmac(`${parts.timestamp}.${payload}`, secret);
  const matched = parts.signatures.some((candidate) => equalsInConstantTime(candidate, expected));

  return matched ? ok(null) : failure(INVALID_SIGNATURE, 'This signature does not match the body.');
}

function parseHeader(header: string): { timestamp: number | null; signatures: string[] } {
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const pair of header.split(',')) {
    const [key, value] = pair.split('=', 2);
    if (key?.trim() === 't' && value) timestamp = Number(value.trim()) || null;
    if (key?.trim() === 'v1' && value) signatures.push(value.trim());
  }

  return { timestamp, signatures };
}

function hmac(signedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(signedPayload).digest('hex');
}

/** Comparing with `===` leaks how many leading characters a guess got right. */
function equalsInConstantTime(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
