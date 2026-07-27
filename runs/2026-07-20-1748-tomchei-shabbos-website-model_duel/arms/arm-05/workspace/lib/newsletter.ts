import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { queueEmail } from "@/lib/email";
import { normalizeEmail } from "@/lib/foundation";

const preferenceTokenLifetimeMs = 1000 * 60 * 60 * 24 * 7;
const confirmationTokenLifetimeMs = 1000 * 60 * 60 * 24;

type PreferenceTokenAudience = "preferences" | "unsubscribe";

type PreferenceTokenPayload = {
  subscriberId: string;
  expiresAt: number;
  keyId: string;
  audience: PreferenceTokenAudience;
};

export type NewsletterPreferences = {
  marketing: boolean;
  updates: boolean;
  reminders: boolean;
};

function signingKeys() {
  const configuredKeys = process.env.NEWSLETTER_TOKEN_SECRETS?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(":");
      return separator > 0 ? [entry.slice(0, separator), entry.slice(separator + 1)] as const : null;
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry?.[1]));
  if (configuredKeys?.length) return new Map(configuredKeys);

  const legacySecret = process.env.NEWSLETTER_TOKEN_SECRET;
  return legacySecret ? new Map([["v1", legacySecret]]) : new Map<string, string>();
}

function currentSigningKey() {
  const key = signingKeys().entries().next().value;
  if (!key) throw new Error("A newsletter token signing key is required.");
  return key;
}

function encodePayload(payload: PreferenceTokenPayload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createPreferenceToken(
  subscriberId: string,
  audience: PreferenceTokenAudience,
  expiresAt = Date.now() + preferenceTokenLifetimeMs,
) {
  const [keyId, secret] = currentSigningKey();
  const payload = encodePayload({ subscriberId, expiresAt, keyId, audience });
  return `${payload}.${sign(payload, secret)}`;
}

function readPreferenceToken(token: string, audience: PreferenceTokenAudience) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PreferenceTokenPayload;
    if (
      !decoded.subscriberId
      || !decoded.keyId
      || decoded.audience !== audience
      || !Number.isFinite(decoded.expiresAt)
      || decoded.expiresAt <= Date.now()
    ) {
      return null;
    }
    const secret = signingKeys().get(decoded.keyId);
    if (!secret) return null;
    const expectedSignature = sign(payload, secret);
    if (signature.length !== expectedSignature.length) return null;
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return null;
    return { subscriberId: decoded.subscriberId };
  } catch {
    return null;
  }
}

export function createNewsletterPreferencesToken(subscriberId: string, expiresAt?: number) {
  return createPreferenceToken(subscriberId, "preferences", expiresAt);
}

export function createUnsubscribeToken(subscriberId: string, expiresAt?: number) {
  return createPreferenceToken(subscriberId, "unsubscribe", expiresAt);
}

export function readUnsubscribeToken(token: string) {
  return readPreferenceToken(token, "unsubscribe");
}

export async function subscribe(email: string) {
  const normalizedEmail = normalizeEmail(email);
  const existingSubscriber = await prisma.newsletterSubscriber.findUnique({ where: { email: normalizedEmail } });
  if (existingSubscriber?.confirmedAt) return { subscriber: existingSubscriber, confirmationToken: null };

  const confirmationToken = randomBytes(32).toString("base64url");
  const confirmationTokenExpiresAt = new Date(Date.now() + confirmationTokenLifetimeMs);
  const subscriber = existingSubscriber
    ? await prisma.newsletterSubscriber.update({
      where: { id: existingSubscriber.id },
      data: { confirmationTokenHash: hashToken(confirmationToken), confirmationTokenExpiresAt },
    })
    : await prisma.newsletterSubscriber.create({
      data: { email: normalizedEmail, confirmationTokenHash: hashToken(confirmationToken), confirmationTokenExpiresAt },
    });
  return { subscriber, confirmationToken };
}

export async function deliverSubscriptionConfirmation(email: string, confirmationToken: string, siteUrl: string) {
  const webhookUrl = process.env.NEWSLETTER_DELIVERY_WEBHOOK_URL;
  const confirmationUrl = `${siteUrl}/api/newsletter/confirm?token=${encodeURIComponent(confirmationToken)}`;
  if (!webhookUrl) {
    await queueEmail({
      eventKey: "NEWSLETTER_CONFIRMATION",
      recipient: email,
      subject: "Confirm your Tomchei Shabbos newsletter subscription",
      html: `<p><a href="${confirmationUrl}">Confirm your subscription</a></p>`,
      dedupeKey: `newsletter-confirmation:${confirmationToken}`,
      payload: { confirmationUrl },
    });
    return;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.NEWSLETTER_DELIVERY_WEBHOOK_SECRET
        ? { authorization: `Bearer ${process.env.NEWSLETTER_DELIVERY_WEBHOOK_SECRET}` }
        : {}),
    },
    body: JSON.stringify({
      to: email,
      type: "newsletter-confirmation",
      confirmationUrl,
    }),
  });
  if (!response.ok) throw new Error("Newsletter delivery failed.");
}

export async function confirmSubscription(confirmationToken: string) {
  const now = new Date();
  const subscriber = await prisma.newsletterSubscriber.findFirst({
    where: { confirmationTokenHash: hashToken(confirmationToken), confirmationTokenExpiresAt: { gt: now } },
    select: { id: true },
  });
  if (!subscriber) return null;
  const outcome = await prisma.newsletterSubscriber.updateMany({
    where: {
      id: subscriber.id,
      confirmationTokenHash: hashToken(confirmationToken),
      confirmationTokenExpiresAt: { gt: now },
    },
    data: { confirmationTokenHash: null, confirmationTokenExpiresAt: null, confirmedAt: now, unsubscribedAt: null },
  });
  return outcome.count ? subscriber : null;
}

export async function getNewsletterSubscription(token: string) {
  const payload = readPreferenceToken(token, "preferences");
  if (!payload) return null;
  return prisma.newsletterSubscriber.findFirst({
    where: { id: payload.subscriberId, confirmedAt: { not: null } },
    select: { preferences: true, unsubscribedAt: true },
  });
}

export async function updateNewsletterPreferences(token: string, preferences: NewsletterPreferences) {
  const payload = readPreferenceToken(token, "preferences");
  if (!payload) return false;
  const outcome = await prisma.newsletterSubscriber.updateMany({
    where: { id: payload.subscriberId, confirmedAt: { not: null } },
    data: { preferences },
  });
  return outcome.count > 0;
}

export async function unsubscribe(token: string) {
  const payload = readUnsubscribeToken(token);
  if (!payload) return false;
  const outcome = await prisma.newsletterSubscriber.updateMany({
    where: { id: payload.subscriberId, confirmedAt: { not: null } },
    data: { unsubscribedAt: new Date() },
  });
  return outcome.count > 0;
}
