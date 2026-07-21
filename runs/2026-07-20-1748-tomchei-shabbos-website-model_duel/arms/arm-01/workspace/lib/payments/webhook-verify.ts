import { createHmac, timingSafeEqual } from "node:crypto";

// Stripe webhook signature scheme (R-125): the Stripe-Signature header carries
// `t=<unix>,v1=<hmac>`; the HMAC-SHA256 is over `${t}.${rawBody}` with the
// endpoint secret. Same scheme is used by the mock gateway, so this exact
// verification runs in both modes.

const TOLERANCE_SECONDS = 5 * 60;

export function signWebhookPayload(secret: string, payload: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

export function verifyWebhookSignature(secret: string, payload: string, header: string | null): boolean {
  if (!header) return false;
  const parts = new Map(
    header.split(",").map((part) => {
      const [key, ...rest] = part.split("=");
      return [key.trim(), rest.join("=")] as const;
    })
  );
  const timestamp = Number(parts.get("t"));
  const signature = parts.get("v1");
  if (!Number.isFinite(timestamp) || !signature) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const givenBuffer = Buffer.from(signature, "utf8");
  return expectedBuffer.length === givenBuffer.length && timingSafeEqual(expectedBuffer, givenBuffer);
}
