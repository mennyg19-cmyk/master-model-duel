import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { base64UrlEncode, hmacSha256, safeEqual } from "@/lib/hmac";

// Guest checkout access tokens (R-023): a guest-owned draft carries an HMAC
// of a one-time random token. The raw token is issued once (in the create
// response / checkout URL) and never stored — a DB leak alone cannot open
// guest drafts, and lookups without a valid token return 404 so draft refs
// cannot be enumerated.
export function generateGuestToken(): string {
  return base64UrlEncode(randomBytes(32));
}

export async function hashGuestToken(rawToken: string): Promise<string> {
  return hmacSha256(env.AUTH_SECRET, `guest-draft:${rawToken}`);
}

export async function verifyGuestToken(rawToken: string, storedHash: string | null): Promise<boolean> {
  if (!storedHash) return false;
  const candidate = await hashGuestToken(rawToken);
  return safeEqual(candidate, storedHash);
}
