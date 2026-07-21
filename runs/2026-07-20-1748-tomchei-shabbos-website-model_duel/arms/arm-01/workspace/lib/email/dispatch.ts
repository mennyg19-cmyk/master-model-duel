import type { Notification } from "@prisma/client";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getEmailProvider } from "@/lib/email/provider";
import { getSmsProvider } from "@/lib/sms/provider";

// Outbox dispatcher (R-088, R-181). Every notification row moves
// pending -> sending (claimed) -> sent | failed | captured. The claim is a
// conditional UPDATE on (id + claimable state), so two overlapping sweeps
// racing for the same row produce exactly one winner — the loser's update
// matches zero rows and it moves on (S4: one claim per message).

export const MAX_ATTEMPTS = 5;
/** A "sending" row whose claim is older than this is a crashed sweep — reclaimable. */
const STALE_CLAIM_MS = 10 * 60 * 1000;
const BATCH_SIZE = 100;

// Retry gaps: 1 min, then 5, then 15, then 60. Long enough to ride out a
// provider blip, short enough that Purim-day mail still goes out today.
const BACKOFF_MINUTES = [1, 5, 15, 60];

export type SweepResult = { examined: number; sent: number; captured: number; retried: number; failed: number };

type EmailSendSettings = { from: string; replyTo: string; footer: string };

/**
 * Lazy, memoized loader for the three branding settings. One loader is shared
 * across a whole sweep so a 100-row batch reads each setting once, not per row
 * (Q-M1); capture mode never triggers the read at all.
 */
function createEmailSettingsLoader(): () => Promise<EmailSendSettings> {
  let cached: Promise<EmailSendSettings> | null = null;
  return () =>
    (cached ??= Promise.all([
      getSetting("email.from_address"),
      getSetting("email.reply_to"),
      getSetting("email.branding_footer"),
    ]).then(([from, replyTo, footer]) => ({ from, replyTo, footer })));
}

export async function sweepNotificationOutbox(now = new Date()): Promise<SweepResult> {
  const staleCutoff = new Date(now.getTime() - STALE_CLAIM_MS);
  const due = await db.notification.findMany({
    where: {
      OR: [
        { status: "pending", nextAttemptAt: { lte: now } },
        { status: "sending", claimedAt: { lt: staleCutoff } },
      ],
    },
    orderBy: { nextAttemptAt: "asc" },
    take: BATCH_SIZE,
  });

  const result: SweepResult = { examined: due.length, sent: 0, captured: 0, retried: 0, failed: 0 };
  const loadEmailSettings = createEmailSettingsLoader();
  for (const row of due) {
    const claimed = await db.notification.updateMany({
      where: {
        id: row.id,
        OR: [
          { status: "pending", nextAttemptAt: { lte: now } },
          { status: "sending", claimedAt: { lt: staleCutoff } },
        ],
      },
      data: { status: "sending", claimedAt: now },
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
      await db.$transaction([
        db.notification.update({
          where: { id: row.id },
          data: { status: "captured", attempts: attempt, sentAt: new Date(), claimedAt: null },
        }),
        db.notificationAttempt.create({ data: { notificationId: row.id, outcome: "captured" } }),
      ]);
      return "captured";
    }
    await db.$transaction([
      db.notification.update({
        where: { id: row.id },
        data: { status: "sent", attempts: attempt, sentAt: new Date(), providerMessageId: messageId, claimedAt: null, lastError: null },
      }),
      db.notificationAttempt.create({ data: { notificationId: row.id, outcome: "sent", providerMessageId: messageId } }),
    ]);
    return "sent";
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    const exhausted = attempt >= MAX_ATTEMPTS;
    const backoffMinutes = BACKOFF_MINUTES[Math.min(attempt - 1, BACKOFF_MINUTES.length - 1)];
    await db.$transaction([
      db.notification.update({
        where: { id: row.id },
        data: exhausted
          ? { status: "failed", attempts: attempt, lastError: message, claimedAt: null }
          : {
              status: "pending",
              attempts: attempt,
              lastError: message,
              claimedAt: null,
              nextAttemptAt: new Date(Date.now() + backoffMinutes * 60_000),
            },
      }),
      db.notificationAttempt.create({ data: { notificationId: row.id, outcome: "failed", error: message } }),
    ]);
    return exhausted ? "failed" : "retried";
  }
}

/** Returns the provider message id, or null when test mode captured instead. */
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
