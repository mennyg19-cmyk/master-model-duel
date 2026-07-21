import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Signed account-verification links (SR-01). Registering against an EXISTING
 * passwordless customer row (created by staff phone orders or guest checkout)
 * must prove control of the email before a password is attached — otherwise
 * anyone who knows the address can take over the record and read its order
 * history. Token = base64url(email).expiresMs.hmac, same shape as the
 * newsletter token but HMAC-scoped with a "register" purpose so tokens from
 * one flow can never be replayed in the other.
 */
const TTL_MS = 24 * 60 * 60 * 1000;

function sign(payload: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(`register.${payload}`).digest("base64url");
}

export function createRegistrationToken(email: string): string {
  const encodedEmail = Buffer.from(email.toLowerCase()).toString("base64url");
  const payload = `${encodedEmail}.${Date.now() + TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns the email for a valid token, or null when tampered/expired/malformed. */
export function verifyRegistrationToken(token: string): string | null {
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
