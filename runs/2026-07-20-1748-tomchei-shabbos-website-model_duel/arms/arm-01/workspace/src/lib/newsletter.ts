import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

const tokenLifetimeMs = 30 * 24 * 60 * 60 * 1000;

function getSigningSecret() {
  const secret = process.env.NEWSLETTER_HMAC_SECRET;
  if (!secret || secret.length < 24) {
    throw new Error(
      "NEWSLETTER_HMAC_SECRET must contain at least 24 characters before newsletter links can be issued.",
    );
  }
  return secret;
}

function signTokenPayload(payload: string) {
  return createHmac("sha256", getSigningSecret())
    .update(payload)
    .digest("base64url");
}

export function createNewsletterToken(subscriberId: string, now = Date.now()) {
  const expiresAt = now + tokenLifetimeMs;
  const payload = `${subscriberId}.${expiresAt}`;
  return `${payload}.${signTokenPayload(payload)}`;
}

export function verifyNewsletterToken(token: string, now = Date.now()) {
  const [subscriberId, expiresAtText, providedSignature, extraPart] =
    token.split(".");
  const expiresAt = Number(expiresAtText);
  if (
    !subscriberId ||
    !providedSignature ||
    extraPart ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now
  ) {
    return null;
  }

  const expectedSignature = signTokenPayload(`${subscriberId}.${expiresAt}`);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null;
  }
  return { subscriberId, expiresAt };
}
