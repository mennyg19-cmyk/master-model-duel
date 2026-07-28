// HMAC-signed session cookie codec. Uses Web Crypto so it runs in both the
// Node server and the edge middleware (Clerk swap point: replace this codec
// with Clerk's session verification — callers stay unchanged).

export const SESSION_COOKIE = "arm06_session";

export interface SessionPayload {
  staffUserId: string;
  authSessionId: string;
  impersonatorId?: string;
}

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacSha256(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return base64UrlEncode(new Uint8Array(signature));
}

// Constant-time compare: signature checks must not short-circuit on the first
// differing byte (timing side-channel).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function encodeSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
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
