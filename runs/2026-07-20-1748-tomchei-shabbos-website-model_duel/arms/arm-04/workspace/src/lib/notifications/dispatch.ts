import 'server-only';

import { Prisma, type NotificationChannel, type NotificationLog } from '@prisma/client';

import { firstErrorMessage } from '../core/errors';
import { runCronJobBody } from '../cron/job-run';
import { db } from '../db';
import { readEmailBranding, renderBrandedHtml, senderLine, type EmailBranding } from '../email/branding';
import { getEmailProvider } from '../email/provider';
import {
  PROVIDER_REQUEST_TIMEOUT_MS,
  type MessageProvider,
  type OutgoingMessage,
} from '../messaging/provider';
import { getSmsProvider } from '../sms/provider';

/**
 * The sweep that empties the outbox (R-088, R-181).
 *
 * P9 writes every customer message to `NotificationLog` and nothing sends it.
 * This is the other half: claim what is due, hand it to the channel's provider,
 * and record what happened. Three properties matter and each has a mechanism:
 *
 * - **One delivery per message.** Claiming is a conditional UPDATE, so two
 *   overlapping sweeps cannot both pick up the same row, and the provider is
 *   given the row's dedupe key as an idempotency key in case a claimed send
 *   times out after the provider already accepted it.
 * - **An outage ends in a delivery, not a hole.** A refusal pushes the row
 *   into the future and leaves it queued, further out each time, until it goes
 *   or it has been tried `MAX_DELIVERY_ATTEMPTS` times.
 * - **A failure is auditable.** Every try writes a `NotificationAttempt` row,
 *   so "it arrived in the end" and "it failed four times first" are both
 *   answerable months later.
 *
 * **This function authenticates nobody.** It is the job body; the route that
 * calls it checks the bearer secret first.
 */
export const NOTIFICATION_SWEEP_JOB = 'notifications.outbox-sweep';

export const MAX_DELIVERY_ATTEMPTS = 5;

/** A minute, five, half an hour, two hours — then the message is given up on. */
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000];

const DEFAULT_SWEEP_LIMIT = 100;

/**
 * A claim this old belonged to a sweep that died mid-send.
 *
 * It has to outlast the slowest honest sweep, which is every message in the
 * batch timing out one after another — otherwise a sweep that is still working
 * has its rows taken out from under it by the next one and the message goes
 * twice. Derived from the batch size and the provider timeout so the two
 * cannot drift apart, plus a margin for the database round-trips between
 * sends.
 */
const CLAIM_MARGIN_MS = 5 * 60 * 1000;
const CLAIM_EXPIRY_MS = DEFAULT_SWEEP_LIMIT * PROVIDER_REQUEST_TIMEOUT_MS + CLAIM_MARGIN_MS;

export type SweepSummary = {
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  /** Email rows left alone because the org has no sender address yet. */
  blocked: number;
};

export async function sweepNotificationOutbox(
  options: { now?: Date; limit?: number } = {},
): Promise<SweepSummary> {
  return runCronJobBody(NOTIFICATION_SWEEP_JOB, async () => {
    const now = options.now ?? new Date();
    const branding = await readEmailBranding();
    const sender = senderLine(branding);

    // No sender address is "not set up yet", not "send it from nothing": the
    // rows stay queued with their attempt count untouched, so configuring the
    // address later delivers the backlog instead of finding it burnt out.
    const blocked =
      sender === null
        ? await db.notificationLog.count({ where: { status: 'QUEUED', channel: 'EMAIL' } })
        : 0;

    const claimed = await claimDueMessages(now, options.limit ?? DEFAULT_SWEEP_LIMIT, sender !== null);

    let sent = 0;
    let retrying = 0;
    let failed = 0;

    for (const message of claimed) {
      const outcome = await deliver(message, branding, sender, now);
      if (outcome === 'sent') sent += 1;
      else if (outcome === 'retrying') retrying += 1;
      else failed += 1;
    }

    const summary: SweepSummary = { claimed: claimed.length, sent, retrying, failed, blocked };

    return { value: summary, itemsProcessed: sent, detail: { ...summary } };
  });
}

/**
 * Takes the messages that are due and marks them as this sweep's work in one
 * statement.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes overlapping sweeps safe: the second
 * one walks past the rows the first is holding instead of waiting for them or
 * claiming them twice. The attempt counter goes up here rather than after the
 * send, so a sweep that dies mid-flight still costs the message one try and
 * cannot loop on the same row forever.
 */
async function claimDueMessages(
  now: Date,
  limit: number,
  emailIsSendable: boolean,
): Promise<NotificationLog[]> {
  const staleClaim = new Date(now.getTime() - CLAIM_EXPIRY_MS);

  return db.$queryRaw<NotificationLog[]>`
    UPDATE "NotificationLog"
    SET "claimedAt" = ${wallClockUtc(now)}, "attempts" = "attempts" + 1
    WHERE id IN (
      SELECT id FROM "NotificationLog"
      WHERE "status" = 'QUEUED'
        AND ("channel" <> 'EMAIL' OR ${emailIsSendable})
        AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${wallClockUtc(now)})
        AND ("claimedAt" IS NULL OR "claimedAt" <= ${wallClockUtc(staleClaim)})
      ORDER BY "createdAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
}

/**
 * An instant, in the terms this table is stored in.
 *
 * Prisma keeps `DateTime` as `timestamp` — a wall clock, always UTC — while a
 * bound `Date` arrives as `timestamptz`, so Postgres compares the two through
 * whatever timezone the session happens to be in. On a server that is not on
 * UTC that reads every backoff as hours out, and a refused message is retried
 * immediately instead of in a minute. Converting the parameter explicitly makes
 * the comparison mean the same thing wherever the app runs.
 */
function wallClockUtc(moment: Date): Prisma.Sql {
  return Prisma.sql`CAST(${moment.toISOString()} AS timestamptz) AT TIME ZONE 'UTC'`;
}

type DeliveryOutcome = 'sent' | 'retrying' | 'failed';

async function deliver(
  message: NotificationLog,
  branding: EmailBranding,
  sender: string | null,
  now: Date,
): Promise<DeliveryOutcome> {
  try {
    const receipt = await providerFor(message.channel).send(envelope(message, branding, sender));

    await recordSent(message, receipt.providerReference, now);
    return 'sent';
  } catch (error) {
    // One address the provider hates must not end the sweep: the rest of the
    // queue is other people's boxes, and the reason is written down.
    return recordFailure(message, firstErrorMessage(error), now);
  }
}

function envelope(
  message: NotificationLog,
  branding: EmailBranding,
  sender: string | null,
): OutgoingMessage {
  const common = {
    destination: message.destination,
    subject: message.subject,
    body: message.body,
    idempotencyKey: message.dedupeKey,
  };

  if (message.channel !== 'EMAIL') {
    return { ...common, html: null, sender: null, replyTo: null };
  }

  return {
    ...common,
    html: renderBrandedHtml(branding, { subject: message.subject ?? '', body: message.body }),
    sender,
    replyTo: branding.replyToAddress || null,
  };
}

function providerFor(channel: NotificationChannel): MessageProvider {
  return channel === 'EMAIL' ? getEmailProvider() : getSmsProvider();
}

/**
 * Only a message still QUEUED may be finished off.
 *
 * A claim that outlived its sweep can be picked up by the next one while the
 * first is still in flight, and both then come back with a result for the same
 * row. Without this guard the second one overwrites the provider reference of
 * a delivery that already happened and files a second attempt against it, so
 * the trail says two sends where the provider's idempotency key made sure
 * there was one.
 */
async function recordTerminal(
  messageId: string,
  data: Prisma.NotificationLogUpdateManyMutationInput,
  attempt: Prisma.NotificationAttemptUncheckedCreateInput,
) {
  await db.$transaction(async (tx) => {
    const settled = await tx.notificationLog.updateMany({
      where: { id: messageId, status: 'QUEUED' },
      data,
    });
    if (settled.count === 0) return;

    await tx.notificationAttempt.create({ data: attempt });
  });
}

async function recordSent(message: NotificationLog, providerReference: string, now: Date) {
  await recordTerminal(
    message.id,
    { status: 'SENT', sentAt: now, claimedAt: null, providerReference, lastError: null },
    {
      messageId: message.id,
      attempt: message.attempts,
      outcome: 'SENT',
      providerReference,
    },
  );
}

async function recordFailure(
  message: NotificationLog,
  error: string,
  now: Date,
): Promise<DeliveryOutcome> {
  const givenUp = message.attempts >= MAX_DELIVERY_ATTEMPTS;
  const delay = RETRY_DELAYS_MS[Math.min(message.attempts - 1, RETRY_DELAYS_MS.length - 1)];

  await recordTerminal(
    message.id,
    givenUp
      ? { status: 'FAILED', failedAt: now, claimedAt: null, lastError: error }
      : { claimedAt: null, lastError: error, nextAttemptAt: new Date(now.getTime() + delay) },
    { messageId: message.id, attempt: message.attempts, outcome: 'FAILED', error },
  );

  return givenUp ? 'failed' : 'retrying';
}
