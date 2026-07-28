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

// Generic signed-JSON pair: P4's customer codec (lib/customers/session.ts)
// rides the same sign/verify discipline with its own payload shape.
export async function encodeSignedJson(payload: Record<string, unknown>, secret: string): Promise<string> {
  const body = base64UrlEncode(encodeText(JSON.stringify(payload)));
  const signature = await hmacSha256(secret, body);
  return `${body}.${signature}`;
}

export async function decodeSignedJson(value: string, secret: string): Promise<Record<string, unknown> | null> {
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;
  const expected = await hmacSha256(secret, body);
  if (!safeEqual(signature, expected)) return null;
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function encodeSession(payload: SessionPayload, secret: string): Promise<string> {
  return encodeSignedJson(payload as unknown as Record<string, unknown>, secret);
}

export async function decodeSession(value: string, secret: string): Promise<SessionPayload | null> {
  const parsed = await decodeSignedJson(value, secret);
  if (!parsed) return null;
  if (typeof parsed.staffUserId !== "string" || typeof parsed.authSessionId !== "string") {
    return null;
  }
  return parsed as unknown as SessionPayload;
}
