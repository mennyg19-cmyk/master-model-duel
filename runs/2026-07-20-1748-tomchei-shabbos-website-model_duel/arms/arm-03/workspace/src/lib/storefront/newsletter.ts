import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/normalize";
import { err, ok, type Result } from "@/lib/result";

const DEFAULT_PREFS = { seasons: true, updates: true } as const;
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  const value = process.env.NEWSLETTER_HMAC_SECRET?.trim();
  if (!value) {
    throw new Error("NEWSLETTER_HMAC_SECRET is required (fail-closed; no public fallback).");
  }
  return value;
}

export type NewsletterPrefs = { seasons: boolean; updates: boolean };

export function signUnsubscribeToken(subscriberId: string, tokenVersion: number, exp: number): string {
  const payload = `${subscriberId}.${tokenVersion}.${exp}`;
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): Result<{
  subscriberId: string;
  tokenVersion: number;
  exp: number;
}> {
  const parts = token.split(".");
  if (parts.length !== 4) {
    return err("malformed", "This unsubscribe link is invalid.");
  }
  const [subscriberId, versionRaw, expRaw, sig] = parts;
  const tokenVersion = Number(versionRaw);
  const exp = Number(expRaw);
  if (!subscriberId || !Number.isFinite(tokenVersion) || !Number.isFinite(exp)) {
    return err("malformed", "This unsubscribe link is invalid.");
  }
  if (Date.now() > exp) {
    return err("expired", "This unsubscribe link has expired. Request a new one from your email preferences.");
  }
  const expected = createHmac("sha256", secret())
    .update(`${subscriberId}.${tokenVersion}.${exp}`)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return err("tampered", "This unsubscribe link is invalid.");
  }
  return ok({ subscriberId, tokenVersion, exp });
}

export async function subscribe(
  emailRaw: string,
  preferences?: Partial<NewsletterPrefs>,
): Promise<Result<{ id: string; email: string }>> {
  const email = emailRaw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return err("bad_email", "Enter a valid email address.");
  }
  const emailNorm = normalizeEmail(email);
  const prefs: NewsletterPrefs = {
    seasons: preferences?.seasons ?? DEFAULT_PREFS.seasons,
    updates: preferences?.updates ?? DEFAULT_PREFS.updates,
  };

  const row = await db.newsletterSubscriber.upsert({
    where: { emailNorm },
    create: {
      email,
      emailNorm,
      preferences: prefs,
      confirmedAt: new Date(),
      unsubscribedAt: null,
      tokenVersion: 1,
    },
    update: {
      email,
      preferences: prefs,
      confirmedAt: new Date(),
      unsubscribedAt: null,
      tokenVersion: { increment: 1 },
    },
  });

  // Token is for email delivery only — never returned to the HTTP caller (H3).
  return ok({ id: row.id, email: row.email });
}

/** Mint a signed unsubscribe token for a known subscriber (email/ops paths only). */
export function mintUnsubscribeToken(subscriberId: string, tokenVersion: number): string {
  return signUnsubscribeToken(subscriberId, tokenVersion, Date.now() + TOKEN_TTL_MS);
}

export async function updatePreferencesWithToken(
  token: string,
  preferences: NewsletterPrefs,
): Promise<Result<{ id: string; email: string }>> {
  const verified = verifyUnsubscribeToken(token);
  if (!verified.ok) return verified;
  const row = await db.newsletterSubscriber.findUnique({
    where: { id: verified.value.subscriberId },
  });
  if (!row || row.unsubscribedAt) {
    return err("missing", "No active subscription found.");
  }
  if (row.tokenVersion !== verified.value.tokenVersion) {
    return err("stale", "This preferences link is no longer valid.");
  }
  const updated = await db.newsletterSubscriber.update({
    where: { id: row.id },
    data: { preferences },
  });
  return ok({ id: updated.id, email: updated.email });
}

export async function unsubscribeWithToken(token: string): Promise<Result<{ email: string }>> {
  const verified = verifyUnsubscribeToken(token);
  if (!verified.ok) return verified;
  const row = await db.newsletterSubscriber.findUnique({
    where: { id: verified.value.subscriberId },
  });
  if (!row) return err("missing", "Subscription not found.");
  if (row.tokenVersion !== verified.value.tokenVersion) {
    return err("stale", "This unsubscribe link is no longer valid.");
  }
  if (!row.unsubscribedAt) {
    await db.newsletterSubscriber.update({
      where: { id: row.id },
      data: { unsubscribedAt: new Date(), tokenVersion: { increment: 1 } },
    });
  }
  return ok({ email: row.email });
}
