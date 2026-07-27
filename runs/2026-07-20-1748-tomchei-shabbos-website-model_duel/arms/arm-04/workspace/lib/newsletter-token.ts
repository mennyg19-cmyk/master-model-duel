import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Signed newsletter links (R-018, R-123). Token = base64url(email).expiresMs.hmac —
 * anyone can read the email, nobody can forge or extend one without
 * SESSION_SECRET. Used for both the preferences page and one-click unsubscribe.
 */
const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days, the life of an email link

function sign(payload: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");
}

export function createNewsletterToken(email: string, ttlMs = DEFAULT_TTL_MS): string {
  const encodedEmail = Buffer.from(email.toLowerCase()).toString("base64url");
  const expiresMs = Date.now() + ttlMs;
  const payload = `${encodedEmail}.${expiresMs}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns the email for a valid token, or null when tampered/expired/malformed. */
export function verifyNewsletterToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedEmail, expiresRaw, signature] = parts;

  const expected = Buffer.from(sign(`${encodedEmail}.${expiresRaw}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  const expiresMs = Number(expiresRaw);
  if (!Number.isFinite(expiresMs) || expiresMs < Date.now()) return null;

  try {
    return Buffer.from(encodedEmail, "base64url").toString("utf8");
  } catch {
    return null;
  }
}
