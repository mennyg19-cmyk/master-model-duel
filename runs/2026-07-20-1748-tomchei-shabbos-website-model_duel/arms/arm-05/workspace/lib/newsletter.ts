import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/foundation";

const tokenLifetimeMs = 1000 * 60 * 60 * 24 * 30;

type UnsubscribePayload = {
  subscriberId: string;
  expiresAt: number;
};

export type NewsletterPreferences = {
  marketing: boolean;
  updates: boolean;
  reminders: boolean;
};

function signingSecret() {
  const secret = process.env.NEWSLETTER_TOKEN_SECRET;
  if (!secret) throw new Error("NEWSLETTER_TOKEN_SECRET is required for newsletter unsubscribe links.");
  return secret;
}

function encodePayload(payload: UnsubscribePayload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function sign(payload: string) {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createUnsubscribeToken(subscriberId: string, expiresAt = Date.now() + tokenLifetimeMs) {
  const payload = encodePayload({ subscriberId, expiresAt });
  return `${payload}.${sign(payload)}`;
}

export function readUnsubscribeToken(token: string) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expectedSignature = sign(payload);
  if (signature.length !== expectedSignature.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as UnsubscribePayload;
    if (!decoded.subscriberId || !Number.isFinite(decoded.expiresAt) || decoded.expiresAt <= Date.now()) return null;
    return { subscriberId: decoded.subscriberId };
  } catch {
    return null;
  }
}

export async function subscribe(email: string) {
  const normalizedEmail = normalizeEmail(email);
  const confirmationToken = randomBytes(32).toString("base64url");
  const subscriber = await prisma.newsletterSubscriber.upsert({
    where: { email: normalizedEmail },
    create: { email: normalizedEmail, confirmationTokenHash: hashToken(confirmationToken) },
    update: {
      confirmationTokenHash: hashToken(confirmationToken),
      confirmedAt: null,
      unsubscribedAt: null,
    },
  });
  return { subscriber, confirmationToken };
}

export async function deliverSubscriptionConfirmation(email: string, confirmationToken: string, siteUrl: string) {
  const webhookUrl = process.env.NEWSLETTER_DELIVERY_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("Newsletter delivery is not configured.");

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
      confirmationUrl: `${siteUrl}/api/newsletter/confirm?token=${encodeURIComponent(confirmationToken)}`,
    }),
  });
  if (!response.ok) throw new Error("Newsletter delivery failed.");
}

export async function confirmSubscription(confirmationToken: string) {
  const subscriber = await prisma.newsletterSubscriber.findFirst({
    where: { confirmationTokenHash: hashToken(confirmationToken) },
    select: { id: true },
  });
  if (!subscriber) return null;
  await prisma.newsletterSubscriber.update({
    where: { id: subscriber.id },
    data: { confirmationTokenHash: null, confirmedAt: new Date(), unsubscribedAt: null },
  });
  return subscriber;
}

export async function getNewsletterSubscription(token: string) {
  const payload = readUnsubscribeToken(token);
  if (!payload) return null;
  return prisma.newsletterSubscriber.findFirst({
    where: { id: payload.subscriberId, confirmedAt: { not: null } },
    select: { preferences: true, unsubscribedAt: true },
  });
}

export async function updateNewsletterPreferences(token: string, preferences: NewsletterPreferences) {
  const payload = readUnsubscribeToken(token);
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
