import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../env';

/**
 * Cookie payloads are signed, not encrypted: the contents are readable but any
 * edit invalidates the signature. Only non-secret identifiers go in here.
 */
export function signCookieValue(payload: Record<string, string>): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

export function readSignedCookieValue(cookieValue: string | undefined): Record<string, string> | null {
  if (!cookieValue) return null;

  const separator = cookieValue.lastIndexOf('.');
  if (separator <= 0) return null;

  const body = cookieValue.slice(0, separator);
  const signature = cookieValue.slice(separator + 1);

  if (!signaturesMatch(sign(body), signature)) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : null;
  } catch {
    return null;
  }
}

function sign(body: string): string {
  return createHmac('sha256', env.AUTH_SESSION_SECRET).update(body).digest('base64url');
}

function signaturesMatch(expected: string, received: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  if (expectedBytes.length !== receivedBytes.length) return false;
  return timingSafeEqual(expectedBytes, receivedBytes);
}
