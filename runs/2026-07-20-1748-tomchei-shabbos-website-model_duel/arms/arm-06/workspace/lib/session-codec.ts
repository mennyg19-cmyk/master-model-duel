// HMAC-signed session cookie codec. Uses Web Crypto so it runs in both the
// Node server and the edge middleware (Clerk swap point: replace this codec
// with Clerk's session verification — callers stay unchanged).

import { base64UrlDecode, base64UrlEncode, encodeText, hmacSha256, safeEqual } from "@/lib/hmac";

export const SESSION_COOKIE = "arm06_session";

export interface SessionPayload {
  staffUserId: string;
  authSessionId: string;
  impersonatorId?: string;
}

export async function encodeSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = base64UrlEncode(encodeText(JSON.stringify(payload)));
  const signature = await hmacSha256(secret, body);
  return `${body}.${signature}`;
}

export async function decodeSession(value: string, secret: string): Promise<SessionPayload | null> {
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;
  const expected = await hmacSha256(secret, body);
  if (!safeEqual(signature, expected)) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));
    if (typeof parsed.staffUserId !== "string" || typeof parsed.authSessionId !== "string") {
      return null;
    }
    return parsed as SessionPayload;
  } catch {
    return null;
  }
}
