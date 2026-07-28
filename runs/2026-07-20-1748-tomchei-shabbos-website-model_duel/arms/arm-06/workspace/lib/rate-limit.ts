// Fixed-window per-key rate limiting for unauthenticated routes (subscribe,
// delivery-check). In-memory and per-instance, so it's a speed bump rather
// than a hard cap — it raises the cost of spam upserts and ZIP-allowlist
// enumeration without adding infrastructure. Keys are client IPs from
// lib/client-ip.ts (spoofable; first hop only, capped — same as auth.ts).

const WINDOW_MS = 60_000;
const SUBSCRIBE_LIMIT = 10;
const DELIVERY_CHECK_LIMIT = 60;
const ADDRESS_VALIDATE_LIMIT = 30;
const DRAFT_SAVE_LIMIT = 60;
const MAX_KEYS = 10_000;

const buckets = new Map<string, { windowStart: number; count: number }>();

function hit(key: string, limit: number, now: number): boolean {
  if (buckets.size >= MAX_KEYS) {
    for (const [bucketKey, bucket] of buckets) {
      if (now - bucket.windowStart >= WINDOW_MS) buckets.delete(bucketKey);
    }
  }
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(key, { windowStart: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

export function newsletterRateLimit(clientIp: string, now: number = Date.now()): boolean {
  return hit(`subscribe:${clientIp}`, SUBSCRIBE_LIMIT, now);
}

export function deliveryCheckRateLimit(clientIp: string, now: number = Date.now()): boolean {
  return hit(`delivery-check:${clientIp}`, DELIVERY_CHECK_LIMIT, now);
}

export function addressValidateRateLimit(clientIp: string, now: number = Date.now()): boolean {
  return hit(`address-validate:${clientIp}`, ADDRESS_VALIDATE_LIMIT, now);
}

export function draftSaveRateLimit(clientIp: string, now: number = Date.now()): boolean {
  return hit(`draft-save:${clientIp}`, DRAFT_SAVE_LIMIT, now);
}
