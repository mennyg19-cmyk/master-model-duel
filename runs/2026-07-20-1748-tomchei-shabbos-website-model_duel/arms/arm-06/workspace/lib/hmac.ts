// Web Crypto HMAC-SHA256 + base64url helpers shared by the session codec and
// newsletter tokens; runs in both the Node server and edge middleware.

const encoder = new TextEncoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return base64UrlEncode(new Uint8Array(signature));
}

// Constant-time compare: signature checks must not short-circuit on the first
// differing byte, and must not return early on a length mismatch either
// (timing length oracle). The loop always runs the longer length, cycling the
// shorter string so every index is defined; unequal lengths flip diff up
// front and the loop's cost stays independent of WHERE the difference is.
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length === b.length ? 0 : 1;
  const comparedLength = Math.max(a.length, b.length);
  for (let i = 0; i < comparedLength; i++) {
    diff |= a.charCodeAt(i % a.length) ^ b.charCodeAt(i % b.length);
  }
  return diff === 0;
}

export function encodeText(value: string): Uint8Array {
  return encoder.encode(value);
}
