// HMAC-signed newsletter manage/unsubscribe tokens (R-123). The signed body
// is purpose-prefixed ("newsletter:<id>:<expiry>") so a token can never be
// confused with another HMAC consumer; verification is constant-time.
import { base64UrlDecode, base64UrlEncode, encodeText, hmacSha256, safeEqual } from "@/lib/hmac";

export const UNSUBSCRIBE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function createUnsubscribeToken(
  subscriberId: string,
  secret: string,
  ttlMs: number = UNSUBSCRIBE_TOKEN_TTL_MS,
  now: number = Date.now(),
): Promise<string> {
  const body = base64UrlEncode(encodeText(`newsletter:${subscriberId}:${now + ttlMs}`));
  const signature = await hmacSha256(secret, body);
  return `${body}.${signature}`;
}

export async function verifyUnsubscribeToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): Promise<{ subscriberId: string } | null> {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = await hmacSha256(secret, body);
  if (!safeEqual(signature, expected)) return null;
  const parts = new TextDecoder().decode(base64UrlDecode(body)).split(":");
  const [purpose, subscriberId, expiresAtRaw] = parts;
  if (purpose !== "newsletter" || !subscriberId || !expiresAtRaw) return null;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < now) return null;
  return { subscriberId };
}
