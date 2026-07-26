import 'server-only';

import { env } from './env';

/**
 * `x-forwarded-for` is written by whoever sent the request unless a proxy we
 * control overwrites it. An audit trail with a forgeable IP is worse than one
 * with no IP, so the header is only read when TRUST_PROXY_HEADERS says a
 * trusted proxy is in front of this app.
 */
export function clientIpAddress(requestHeaders: Headers): string | null {
  if (!env.TRUST_PROXY_HEADERS) return null;

  const forwardedFor = requestHeaders.get('x-forwarded-for');
  return forwardedFor?.split(',')[0]?.trim() || null;
}
