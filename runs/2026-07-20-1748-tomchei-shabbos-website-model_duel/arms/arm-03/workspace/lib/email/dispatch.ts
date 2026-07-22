import type { Notification } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getSetting } from "@/lib/settings";
import { getEmailProvider } from "@/lib/email/provider";
import { getSmsProvider } from "@/lib/sms/provider";
import {
  AttemptOutcome,
  NotificationStatus,
  TEST_NOTIFICATION_KINDS,
  isTestNotificationKind,
} from "@/lib/email/notification-lifecycle";

// Outbox dispatcher (R-088, R-181). Every notification row moves
// pending -> sending (claimed) -> sent | failed | captured. The claim is a
// conditional UPDATE on (id + claimable state), so two overlapping sweeps
// racing for the same row produce exactly one winner — the loser's update
// matches zero rows and it moves on (S4: one claim per message).

export const MAX_ATTEMPTS = 5;
/** A "sending" row whose claim is older than this is a crashed sweep — reclaimable. */
const STALE_CLAIM_MS = 10 * 60 * 1000;
const BATCH_SIZE = 100;
const MAX_ERROR_CHARS = 500;

// Retry gaps: 1 min, then 5, then 15, then 60. Long enough to ride out a
// provider blip, short enough that Purim-day mail still goes out today.
const BACKOFF_MINUTES = [1, 5, 15, 60];

export type SweepResult = { examined: number; sent: number; captured: number; retried: number; failed: number };

type EmailSendSettings = { from: string; replyTo: string; footer: string };

/**
 * Lazy, memoized loader for the three branding settings. One loader is shared
 * across a whole sweep so a 100-row batch reads each setting once, not per row
 * (Q-M1); capture mode never triggers the read at all. A rejected first read
 * resets the cache so the next row can retry (A-06).
 */
function createEmailSettingsLoader(): () => Promise<EmailSendSettings> {
  let cached: Promise<EmailSendSettings> | null = null;
  return () => {
    if (!cached) {
      cached = Promise.all([
        getSetting("email.from_address"),
        getSetting("email.reply_to"),
        getSetting("email.branding_footer"),
      ])
        .then(([from, replyTo, footer]) => ({
          from: from || env.EMAIL_FROM || "purim@tomcheishabbos.example.org",
          replyTo,
          footer,
        }))
        .catch((error) => {
          cached = null;
          throw error;
        });
    }
    return cached;
  };
}

function claimableWhere(now: Date, staleCutoff: Date) {
  return {
    OR: [
      { status: NotificationStatus.PENDING, nextAttemptAt: { lte: now } },
      { status: NotificationStatus.SENDING, claimedAt: { lt: staleCutoff } },
    ],
  };
}

export async function sweepNotificationOutbox(now = new Date()): Promise<SweepResult> {
  const staleCutoff = new Date(now.getTime() - STALE_CLAIM_MS);
  const due = await db.notification.findMany({
    where: {
      // Test-send rows must not ride the production sweeper (A-05).
      kind: { notIn: [...TEST_NOTIFICATION_KINDS] },
      ...claimableWhere(now, staleCutoff),
    },
    orderBy: { nextAttemptAt: "asc" },
    take: BATCH_SIZE,
  });

  const result: SweepResult = { examined: due.length, sent: 0, captured: 0, retried: 0, failed: 0 };
  const loadEmailSettings = createEmailSettingsLoader();
  for (const row of due) {
    // A-04: if a prior crash left "sending" after the provider already accepted
    // the message, an attempt trail with sent/captured means we must finalize
    // without calling the provider again.
    if (row.status === NotificationStatus.SENDING) {
      const prior = await db.notificationAttempt.findFirst({
        where: {
          notificationId: row.id,
          outcome: { in: [AttemptOutcome.SENT, AttemptOutcome.CAPTURED] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (prior) {
        await db.notification.update({
          where: { id: row.id },
          data: {
            status: prior.outcome === AttemptOutcome.CAPTURED ? NotificationStatus.CAPTURED : NotificationStatus.SENT,
            sentAt: row.sentAt ?? new Date(),
            providerMessageId: prior.providerMessageId ?? row.providerMessageId,
            claimedAt: null,
            lastError: null,
          },
        });
        result[prior.outcome === AttemptOutcome.CAPTURED ? "captured" : "sent"] += 1;
        continue;
      }
    }

    const claimed = await db.notification.updateMany({
      where: {
        id: row.id,
        ...claimableWhere(now, staleCutoff),
      },
      data: { status: NotificationStatus.SENDING, claimedAt: now },
    });
    if (claimed.count !== 1) continue; // Another sweep owns this row.
    const outcome = await dispatchOne(row, loadEmailSettings);
    result[outcome] += 1;
  }
  return result;
}

/** Dispatch a single claimed row. Exported for the settings test sender. */
export async function dispatchOne(
  row: Notification,
  loadEmailSettings: () => Promise<EmailSendSettings> = createEmailSettingsLoader()
): Promise<"sent" | "captured" | "retried" | "failed"> {
  const attempt = row.attempts + 1;
  try {
    const messageId = await sendThroughProvider(row, attempt, loadEmailSettings);
    if (messageId === null) {
      await finalizeSuccess(row.id, attempt, null, AttemptOutcome.CAPTURED);
      return "captured";
    }
    await finalizeSuccess(row.id, attempt, messageId, AttemptOutcome.SENT);
    return "sent";
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_CHARS);
    // Test-send kinds fail terminal on first error — never re-enter the sweeper (A-05).
    const exhausted = attempt >= MAX_ATTEMPTS || isTestNotificationKind(row.kind);
    const backoffMinutes = exhausted
      ? 0
      : BACKOFF_MINUTES[Math.min(attempt - 1, BACKOFF_MINUTES.length - 1)];
    await db.$transaction([
      db.notification.update({
        where: { id: row.id },
        data: exhausted
          ? { status: NotificationStatus.FAILED, attempts: attempt, lastError: message, claimedAt: null }
          : {
              status: NotificationStatus.PENDING,
              attempts: attempt,
              lastError: message,
              claimedAt: null,
              nextAttemptAt: new Date(Date.now() + backoffMinutes * 60_000),
            },
      }),
      db.notificationAttempt.create({
        data: { notificationId: row.id, outcome: AttemptOutcome.FAILED, error: message },
      }),
    ]);
    return exhausted ? "failed" : "retried";
  }
}

/**
 * Persist a successful delivery. If the transaction fails after the provider
 * already accepted the message, best-effort mark the row terminal so the
 * sweeper never reclaims and double-sends (A-04).
 */
async function finalizeSuccess(
  notificationId: string,
  attempt: number,
  messageId: string | null,
  outcome: typeof AttemptOutcome.SENT | typeof AttemptOutcome.CAPTURED
): Promise<void> {
  const status = outcome === AttemptOutcome.CAPTURED ? NotificationStatus.CAPTURED : NotificationStatus.SENT;
  const data = {
    status,
    attempts: attempt,
    sentAt: new Date(),
    claimedAt: null as Date | null,
    lastError: null as string | null,
    ...(messageId ? { providerMessageId: messageId } : {}),
  };
  try {
    await db.$transaction([
      db.notification.update({ where: { id: notificationId }, data }),
      db.notificationAttempt.create({
        data: {
          notificationId,
          outcome,
          ...(messageId ? { providerMessageId: messageId } : {}),
        },
      }),
    ]);
  } catch {
    // Provider already delivered — never leave reclaimable "sending".
    await db.notification.update({ where: { id: notificationId }, data }).catch(() => undefined);
    await db.notificationAttempt
      .create({
        data: {
          notificationId,
          outcome,
          ...(messageId ? { providerMessageId: messageId } : {}),
        },
      })
      .catch(() => undefined);
  }
}

/** Returns the provider message id, or null when test/capture mode captured instead. */
async function sendThroughProvider(
  row: Notification,
  attempt: number,
  loadEmailSettings: () => Promise<EmailSendSettings>
): Promise<string | null> {
  if (row.channel === "EMAIL") {
    const provider = getEmailProvider();
    if (provider.mode === "capture") return null;
    const { from, replyTo, footer } = await loadEmailSettings();
    const outcome = await provider.send(
      {
        to: row.recipient,
        from,
        replyTo,
        subject: row.subject ?? "(no subject)",
        body: footer ? `${row.body}\n\n—\n${footer}` : row.body,
      },
      attempt
    );
    return outcome.messageId;
  }
  const sms = getSmsProvider();
  if (sms.mode === "capture") return null;
  const outcome = await sms.send({ to: row.recipient, body: row.body }, attempt);
  return outcome.messageId;
}
