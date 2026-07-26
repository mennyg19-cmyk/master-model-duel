import 'server-only';

import type { NewsletterSubscriber } from '@prisma/client';
import { z } from 'zod';

import { db } from '../db';
import { normalizeEmail } from '../core/normalize';
import { failure, ok, type Result } from '../core/result';
import type { NewsletterPreference } from './preferences';
import { createUnsubscribeToken, readUnsubscribeToken, UNSUBSCRIBE_TOKEN_MESSAGES } from './tokens';

export const INVALID_TOKEN = 'invalid_token';

const emailSchema = z.email('Enter an email address like name@example.com').max(254);

export type Subscription = { subscriber: NewsletterSubscriber; manageToken: string };

/**
 * Subscribing twice is the normal case — people forget — so this upserts and
 * returns the same answer either way. Re-subscribing an address that opted out
 * turns it back on: asking again is consent.
 */
export async function subscribe(input: {
  email: string;
  source: string;
  preferences?: Partial<Record<NewsletterPreference, boolean>>;
}): Promise<Result<Subscription>> {
  const parsed = emailSchema.safeParse(input.email.trim());
  if (!parsed.success) {
    return failure('invalid_email', parsed.error.issues[0].message);
  }

  const email = parsed.data;
  const subscriber = await db.newsletterSubscriber.upsert({
    where: { normalizedEmail: normalizeEmail(email) },
    create: {
      email,
      normalizedEmail: normalizeEmail(email),
      source: input.source,
      ...input.preferences,
    },
    update: {
      email,
      status: 'SUBSCRIBED',
      unsubscribedAt: null,
      ...input.preferences,
    },
  });

  return ok({ subscriber, manageToken: createUnsubscribeToken(subscriber.id) });
}

/**
 * A subscriber has no account and no session, so the signed link is the only
 * credential. An unknown id fails with the same message as a bad signature: the
 * page must not become a way to test which ids exist.
 */
export async function loadByToken(token: string | undefined): Promise<Result<NewsletterSubscriber>> {
  const check = readUnsubscribeToken(token);
  if (!check.valid) return failure(INVALID_TOKEN, UNSUBSCRIBE_TOKEN_MESSAGES[check.reason]);

  const subscriber = await db.newsletterSubscriber.findUnique({ where: { id: check.subscriberId } });
  if (!subscriber) {
    return failure(INVALID_TOKEN, UNSUBSCRIBE_TOKEN_MESSAGES.bad_signature);
  }

  return ok(subscriber);
}

export async function updatePreferencesByToken(
  token: string | undefined,
  preferences: Record<NewsletterPreference, boolean>,
): Promise<Result<NewsletterSubscriber>> {
  const loaded = await loadByToken(token);
  if (!loaded.ok) return loaded;

  return ok(
    await db.newsletterSubscriber.update({
      where: { id: loaded.value.id },
      data: preferences,
    }),
  );
}

/**
 * The row stays and only its status changes. Deleting it would let the next
 * import add the address back, and would erase the proof that the person asked
 * to be taken off the list.
 */
export async function unsubscribeByToken(
  token: string | undefined,
): Promise<Result<NewsletterSubscriber>> {
  const loaded = await loadByToken(token);
  if (!loaded.ok) return loaded;

  if (loaded.value.status === 'UNSUBSCRIBED') return ok(loaded.value);

  return ok(
    await db.newsletterSubscriber.update({
      where: { id: loaded.value.id },
      data: { status: 'UNSUBSCRIBED', unsubscribedAt: new Date() },
    }),
  );
}
