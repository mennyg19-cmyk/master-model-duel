import 'server-only';

import { runCronJobBody } from '../cron/job-run';
import { db } from '../db';
import { readSetting } from '../settings';

/**
 * The email-log purge (R-172).
 *
 * The outbox holds the text of every message this organisation has ever sent a
 * donor, which is a growing pile of other people's names and addresses. A
 * delivered message older than the retention window is deleted; nothing else
 * is.
 *
 * What survives on purpose:
 *
 * - **Queued and failed rows.** They are the working outbox — deleting one is
 *   a message that never goes out, or a failure nobody ever answers. A failure
 *   nobody answered for a whole retention window is not working outbox any
 *   more though, so past the cutoff the row stays and its text goes.
 * - **Campaign sends.** `EmailCampaignSend` keeps its own row and merely loses
 *   the link to the deleted message, so purging a year of newsletters can
 *   never make a rerun mail those people again.
 * - **Audit evidence.** `AuditEvent` and `CronRunLog` are not touched at all:
 *   the record that the office notified somebody outlives the copy of what was
 *   said.
 *
 * **This function authenticates nobody.** It is the job body; the route that
 * calls it checks the bearer secret first.
 */
export const EMAIL_LOG_PURGE_JOB = 'notifications.log-purge';

export type PurgeSummary = {
  retentionDays: number;
  messages: number;
  captures: number;
  /** Failed rows kept as evidence with the customer's text taken out of them. */
  redacted: number;
};

export const REDACTED_BODY = 'Removed: this message failed and passed the retention window.';

export async function purgeDeliveredMessages(now: Date = new Date()): Promise<PurgeSummary> {
  return runCronJobBody(EMAIL_LOG_PURGE_JOB, async () => {
    const retentionDays = await readSetting('email.logRetentionDays');
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    const messages = await db.notificationLog.deleteMany({
      where: { status: 'SENT', sentAt: { lt: cutoff } },
    });

    // Test-mode captures are copies of the same text with no delivery to
    // prove, so they go on the same clock.
    const captures = await db.capturedMessage.deleteMany({ where: { capturedAt: { lt: cutoff } } });

    // The row is the record that the office tried and failed, which is worth
    // keeping. The body is the customer's name, their order total and a
    // payment link, which is not — not once nobody has acted on it in the
    // whole window a delivered message would have been kept for.
    const redacted = await db.notificationLog.updateMany({
      where: { status: 'FAILED', failedAt: { lt: cutoff }, body: { not: REDACTED_BODY } },
      data: { body: REDACTED_BODY, subject: null },
    });

    const summary: PurgeSummary = {
      retentionDays,
      messages: messages.count,
      captures: captures.count,
      redacted: redacted.count,
    };

    return { value: summary, itemsProcessed: messages.count, detail: { ...summary } };
  });
}
