import 'server-only';

import { z } from 'zod';

import { failure, ok, type Result } from '../core/result';
import { db } from '../db';
import { findOwnedDraftById, type DraftOwner } from '../orders/draft-access';
import { recipientDestinationKey } from '../orders/grouping';
import { isLineAssigned } from '../orders/lines';

/**
 * The card that travels in the box (UR-013, G-020).
 *
 * One message can be set for the whole order and overridden for a single
 * recipient. Whatever a recipient ends up with is written back onto their
 * address-book row, so next Purim their card is already filled in — the org's
 * donors send the same line to the same aunt every year, and typing it again is
 * the part they complain about.
 */
export const GREETING_NOT_ALLOWED = 'greeting_not_allowed';
export const INVALID_GREETING = 'invalid_greeting';
/**
 * The delivery day is asked for on the same card as the greeting, but a caller
 * switching on the code has to be able to tell which of the two the customer
 * got wrong.
 */
export const INVALID_DELIVERY_DAY = 'invalid_delivery_day';
export const RECIPIENT_NOT_ON_ORDER = 'recipient_not_on_order';

const MAX_GREETING_LENGTH = 500;

const greetingSchema = z
  .string()
  .trim()
  .max(MAX_GREETING_LENGTH, `A card message has to fit in ${MAX_GREETING_LENGTH} characters.`)
  .transform((value) => (value === '' ? null : value));

export type GreetingScope = { orderId: string; recipientKey: string | null };

/**
 * Sets the order's default and fills in every recipient that has no card of
 * their own. An override already typed stays put: the default is a starting
 * point, not a broadcast.
 */
export async function setDefaultGreeting(
  owner: DraftOwner,
  orderId: string,
  raw: string,
): Promise<Result<{ appliedToLines: number }>> {
  const greeting = greetingSchema.safeParse(raw);
  if (!greeting.success) return failure(INVALID_GREETING, greeting.error.issues[0].message);

  const draft = await findOwnedDraftById(owner, orderId);
  if (!draft) return failure(GREETING_NOT_ALLOWED, 'That order is no longer open.');

  await db.order.update({ where: { id: draft.id }, data: { defaultGreeting: greeting.data } });

  const filled = await db.orderLine.updateMany({
    where: { orderId: draft.id, greetingMessage: null },
    data: { greetingMessage: greeting.data },
  });

  await rememberGreetings(owner, draft.id);
  return ok({ appliedToLines: filled.count });
}

/** One recipient's card, applied to every box going to them. */
export async function setRecipientGreeting(
  owner: DraftOwner,
  orderId: string,
  recipientKey: string,
  raw: string,
): Promise<Result<{ appliedToLines: number }>> {
  const greeting = greetingSchema.safeParse(raw);
  if (!greeting.success) return failure(INVALID_GREETING, greeting.error.issues[0].message);

  const lineIds = await linesForRecipient(owner, orderId, recipientKey);
  if (lineIds.length === 0) {
    return failure(RECIPIENT_NOT_ON_ORDER, 'That recipient is not on this order.');
  }

  const applied = await db.orderLine.updateMany({
    where: { id: { in: lineIds } },
    data: { greetingMessage: greeting.data },
  });

  await rememberGreetings(owner, orderId);
  return ok({ appliedToLines: applied.count });
}

/**
 * Which day this recipient's delivery goes out (UR-009, G-015). Only the days
 * the manager opened are accepted: the drivers' calendar is not a free-text
 * field a form can widen.
 */
export async function setRecipientDeliveryDay(
  owner: DraftOwner,
  orderId: string,
  recipientKey: string,
  day: string,
  allowedDays: string[],
): Promise<Result<{ appliedToLines: number }>> {
  if (!allowedDays.includes(day)) {
    return failure(INVALID_DELIVERY_DAY, 'Choose one of the delivery days we are running.');
  }

  const lineIds = await linesForRecipient(owner, orderId, recipientKey);
  if (lineIds.length === 0) {
    return failure(RECIPIENT_NOT_ON_ORDER, 'That recipient is not on this order.');
  }

  const applied = await db.orderLine.updateMany({
    where: { id: { in: lineIds } },
    data: { deliveryDay: day },
  });

  return ok({ appliedToLines: applied.count });
}

async function linesForRecipient(
  owner: DraftOwner,
  orderId: string,
  recipientKey: string,
): Promise<string[]> {
  const draft = await findOwnedDraftById(owner, orderId);
  if (!draft) return [];

  const lines = await db.orderLine.findMany({ where: { orderId: draft.id } });

  return lines
    .filter(isLineAssigned)
    .filter((line) => recipientDestinationKey(line) === recipientKey)
    .map((line) => line.id);
}

/**
 * Copies each recipient's current card onto their saved address, which is what
 * makes it the default next season. Guests have no address book to write to.
 */
async function rememberGreetings(owner: DraftOwner, orderId: string): Promise<void> {
  if (owner.kind !== 'customer') return;

  const lines = await db.orderLine.findMany({
    where: { orderId, customerAddressId: { not: null }, greetingMessage: { not: null } },
    select: { customerAddressId: true, greetingMessage: true },
  });

  for (const line of lines) {
    await db.customerAddress.updateMany({
      where: { id: line.customerAddressId!, customerId: owner.customerId },
      data: { lastGreeting: line.greetingMessage },
    });
  }
}
