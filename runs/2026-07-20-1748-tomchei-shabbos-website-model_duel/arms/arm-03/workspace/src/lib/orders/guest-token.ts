import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

function secret(): string {
  const value =
    process.env.DRAFT_ACCESS_SECRET?.trim() ||
    process.env.NEWSLETTER_HMAC_SECRET?.trim();
  if (!value) {
    throw new Error("DRAFT_ACCESS_SECRET (or NEWSLETTER_HMAC_SECRET) is required.");
  }
  return value;
}

export function hashGuestToken(rawToken: string, version: number): string {
  return createHash("sha256")
    .update(`${secret()}:${version}:${rawToken}`)
    .digest("hex");
}

export function mintGuestToken(): string {
  return randomBytes(24).toString("base64url");
}

export function guestTokenMatches(
  rawToken: string | null | undefined,
  hash: string | null | undefined,
  version: number,
): boolean {
  if (!rawToken || !hash) return false;
  const expected = Buffer.from(hashGuestToken(rawToken, version), "hex");
  const actual = Buffer.from(hash, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export const GUEST_DRAFT_COOKIE = "guest_draft_token";
export const GUEST_DRAFT_COOKIE_MAX_AGE = 60 * 60 * 24 * 14;

/** httpOnly + secure cookie — never expose token in JSON or readable document.cookie (M1). */
export function guestDraftCookieOptions(maxAge = GUEST_DRAFT_COOKIE_MAX_AGE) {
  return {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    maxAge,
  };
}
