import 'server-only';

import type { NotificationChannel } from '@prisma/client';

import type { DbClient } from '../core/db-client';
import { db } from '../db';

/**
 * The notification outbox (G-021, G-026).
 *
 * P9 has to be able to say "one email and one SMS went to this customer" and
 * "the day-of notice cannot go twice", and both are properties of a record
 * rather than of a mail server. So a message is written here, keyed by the event
 * it belongs to, and P11 adds the transport that drains the table.
 *
 * Writing is idempotent by construction: `dedupeKey` is unique, and a collision
 * is the answer "already sent", not an error. Callers get back what happened so
 * a screen can say "3 sent, 2 already had one".
 */
export type OutboxMessage = {
  channel: NotificationChannel;
  kind: string;
  destination: string;
  subject?: string;
  body: string;
  dedupeKey: string;
  customerId?: string | null;
  orderId?: string | null;
  packageId?: string | null;
  routeId?: string | null;
};

export type OutboxResult = { queued: number; alreadySent: number; skipped: number };

export const EMPTY_OUTBOX_RESULT: OutboxResult = { queued: 0, alreadySent: 0, skipped: 0 };

/**
 * Queues one message unless its key is already in the table.
 *
 * `skipped` rather than `queued` when there is nowhere to send it: a customer
 * with no mobile number is a real and common case, and inventing a destination
 * to keep a count tidy would send Purim greetings to whoever owns that address.
 */
export async function queueMessage(
  message: OutboxMessage,
  client: DbClient = db,
): Promise<OutboxResult> {
  if (message.destination.trim() === '') return { ...EMPTY_OUTBOX_RESULT, skipped: 1 };

  const existing = await client.notificationLog.findUnique({
    where: { dedupeKey: message.dedupeKey },
    select: { id: true },
  });

  if (existing) return { ...EMPTY_OUTBOX_RESULT, alreadySent: 1 };

  try {
    await client.notificationLog.create({
      data: {
        channel: message.channel,
        kind: message.kind,
        destination: message.destination.trim(),
        subject: message.subject ?? null,
        body: message.body,
        dedupeKey: message.dedupeKey,
        customerId: message.customerId ?? null,
        orderId: message.orderId ?? null,
        packageId: message.packageId ?? null,
        routeId: message.routeId ?? null,
      },
    });

    return { ...EMPTY_OUTBOX_RESULT, queued: 1 };
  } catch (error) {
    // Two sweeps racing on the same event land here: the unique key did its job
    // and the message exists, which is the outcome the caller wanted.
    if (isUniqueViolation(error)) return { ...EMPTY_OUTBOX_RESULT, alreadySent: 1 };
    throw error;
  }
}

/**
 * The pair a customer-facing event sends: an email and, when the org has a
 * mobile number for them, a text (G-021). Two rows rather than one with two
 * channels, because they are two deliveries that succeed and fail separately.
 */
export async function queueCustomerMessage(
  input: {
    kind: string;
    dedupeKey: string;
    email: string | null;
    phone: string | null;
    subject: string;
    body: string;
    smsBody?: string;
    customerId?: string | null;
    orderId?: string | null;
    packageId?: string | null;
    routeId?: string | null;
  },
  client: DbClient = db,
): Promise<OutboxResult> {
  const shared = {
    kind: input.kind,
    customerId: input.customerId,
    orderId: input.orderId,
    packageId: input.packageId,
    routeId: input.routeId,
  };

  const email = await queueMessage(
    {
      ...shared,
      channel: 'EMAIL',
      destination: input.email ?? '',
      subject: input.subject,
      body: input.body,
      dedupeKey: `${input.dedupeKey}:email`,
    },
    client,
  );

  const sms = await queueMessage(
    {
      ...shared,
      channel: 'SMS',
      destination: input.phone ?? '',
      body: input.smsBody ?? input.body,
      dedupeKey: `${input.dedupeKey}:sms`,
    },
    client,
  );

  return addResults(email, sms);
}

export function addResults(...results: OutboxResult[]): OutboxResult {
  return results.reduce(
    (total, result) => ({
      queued: total.queued + result.queued,
      alreadySent: total.alreadySent + result.alreadySent,
      skipped: total.skipped + result.skipped,
    }),
    EMPTY_OUTBOX_RESULT,
  );
}

/** "2 sent, 1 already had one, 1 had nowhere to send" — what staff need to read. */
export function describeOutbox(result: OutboxResult): string {
  const parts = [`${result.queued} sent`];
  if (result.alreadySent > 0) parts.push(`${result.alreadySent} already had one`);
  if (result.skipped > 0) parts.push(`${result.skipped} had no address or number on file`);

  return parts.join(', ');
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}
