import 'server-only';

import type { SubscriberList } from '@prisma/client';
import { z } from 'zod';

import { normalizeEmail } from '../core/normalize';
import { failure, ok, type Result } from '../core/result';
import { db } from '../db';

/**
 * Named slices of the newsletter list (R-084).
 *
 * A list is who a letter is for; the three preference flags are what a person
 * has agreed to receive. Both are checked when a campaign sends, so adding
 * somebody to "Drivers" never overrides their opt-out.
 *
 * Membership is by subscriber, and a subscriber is an address on the
 * newsletter table — an address the office types in that has never subscribed
 * is added to the list *and* to the newsletter, because a list of people the
 * newsletter does not know about would be a second, invisible mailing list.
 */
export const LIST_NOT_FOUND = 'subscriber_list_not_found';
export const LIST_INVALID = 'subscriber_list_invalid';
export const SUBSCRIBER_NOT_FOUND = 'subscriber_not_found';

const listSchema = z.object({
  name: z.string().trim().min(1, 'Give the list a name.').max(80),
  description: z.string().trim().max(280).default(''),
});

export type SubscriberListInput = z.input<typeof listSchema>;

export async function createSubscriberList(
  input: SubscriberListInput,
): Promise<Result<SubscriberList>> {
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) return failure(LIST_INVALID, parsed.error.issues[0].message);

  const slug = slugFromName(parsed.data.name);
  const taken = await db.subscriberList.findUnique({ where: { slug } });
  if (taken) return failure(LIST_INVALID, `There is already a list called ${taken.name}.`);

  return ok(await db.subscriberList.create({ data: { ...parsed.data, slug } }));
}

/**
 * Adds one address to a list. Joining twice is the normal case — the office
 * pastes an overlapping batch — so it answers the same either way.
 */
export async function addToList(listId: string, email: string): Promise<Result<{ added: boolean }>> {
  const list = await db.subscriberList.findUnique({ where: { id: listId } });
  if (!list) return failure(LIST_NOT_FOUND, 'That list no longer exists.');

  const subscriber = await db.newsletterSubscriber.findUnique({
    where: { normalizedEmail: normalizeEmail(email) },
  });
  if (!subscriber) {
    return failure(
      SUBSCRIBER_NOT_FOUND,
      `${email.trim()} is not on the newsletter list, so there is nothing to add. Ask them to sign up first.`,
    );
  }

  const existing = await db.subscriberListMember.findUnique({
    where: { listId_subscriberId: { listId, subscriberId: subscriber.id } },
  });
  if (existing) return ok({ added: false });

  await db.subscriberListMember.create({ data: { listId, subscriberId: subscriber.id } });
  return ok({ added: true });
}

export async function removeFromList(listId: string, subscriberId: string): Promise<void> {
  await db.subscriberListMember.deleteMany({ where: { listId, subscriberId } });
}

/** `Last year's drivers` becomes `last-years-drivers`. */
function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
