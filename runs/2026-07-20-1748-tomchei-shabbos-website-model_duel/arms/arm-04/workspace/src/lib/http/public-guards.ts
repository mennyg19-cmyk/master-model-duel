import 'server-only';

import { env } from '../env';
import { clientIpAddress } from '../request-ip';

/**
 * What every endpoint a stranger can reach has to pass (R-122).
 *
 * A public route has no session to lean on, so it defends itself: a bounded
 * body, a cap on how often one caller may knock, and — where the caller is
 * supposed to be our own page — a same-origin check. Zod validation is the
 * fourth part and lives with each route's own schema.
 *
 * The counter is per process and in memory. That is honest for a single
 * deployment and deliberately not a distributed limiter: a shared store is a
 * P12 concern, and a limiter that pretends to be global while it is not is
 * worse than one that says what it is.
 */
export type RateLimitRule = { limit: number; windowMs: number };

type Window = { startedAt: number; count: number };

const windows = new Map<string, Window>();

/** Keeps the map from growing one entry per attacker-chosen key, forever. */
const MAX_TRACKED_KEYS = 5_000;

export function withinRateLimit(bucket: string, caller: string, rule: RateLimitRule): boolean {
  const key = `${bucket}:${caller}`;
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || now - existing.startedAt > rule.windowMs) {
    if (windows.size >= MAX_TRACKED_KEYS) makeRoom(now, rule.windowMs);
    windows.set(key, { startedAt: now, count: 1 });
    return true;
  }

  existing.count += 1;
  return existing.count <= rule.limit;
}

/**
 * Lapsed windows first, because they are free to lose. If a burst of distinct
 * live keys fills the map anyway, the oldest live window goes: the cap is what
 * makes it a cap, and forgetting the longest-standing allowance costs one caller
 * a fresh window rather than costing the process its memory.
 */
function makeRoom(now: number, windowMs: number): void {
  for (const [key, window] of windows) {
    if (now - window.startedAt > windowMs) windows.delete(key);
  }

  if (windows.size < MAX_TRACKED_KEYS) return;

  let oldestKey: string | null = null;
  let oldestStartedAt = Number.POSITIVE_INFINITY;

  for (const [key, window] of windows) {
    if (window.startedAt >= oldestStartedAt) continue;
    oldestKey = key;
    oldestStartedAt = window.startedAt;
  }

  if (oldestKey !== null) windows.delete(oldestKey);
}

/**
 * Who to count against. With no trusted proxy in front there is no honest
 * client address — `x-forwarded-for` is written by the caller — so everyone
 * shares one bucket rather than each forged header getting its own allowance.
 */
export function rateLimitCaller(headers: Headers): string {
  return clientIpAddress(headers) ?? 'untrusted-source';
}

/**
 * Rejects a cross-site POST to a route that only our own pages should call.
 * A request with no `origin` at all is refused too: a browser always sends one
 * on a cross-origin POST, so its absence is a caller that is not a browser.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(env.APP_URL).origin;
  } catch {
    return false;
  }
}
