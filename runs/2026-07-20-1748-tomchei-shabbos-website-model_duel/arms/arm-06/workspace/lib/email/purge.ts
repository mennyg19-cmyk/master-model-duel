import { prisma } from "@/lib/db";
import { DomainRuleError } from "@/lib/errors";
import { MILLIS_PER_DAY } from "@/lib/dates";
import { getSetting } from "@/lib/settings";

// R-172: the email-log purge. Eligible = SENT outbox rows and SENT/SKIPPED
// campaign recipients older than retentionDays, plus FAILED outbox rows past
// the much longer failure-trail window below. NEVER eligible: PENDING or
// SENDING rows (the active outbox), recent FAILED rows, and AuditLog/CronRun
// rows (audit evidence). The CronRun message is the durable record of what
// each purge removed.
//
// The FAILED failure trail is auditable, not eternal: a chronic provider
// issue at scale would otherwise grow the table without bound. One year is
// long enough to reconstruct any real incident.
const FAILED_TRAIL_RETENTION_DAYS = 365;

export interface EmailPurgeResult {
  cronRunId: string;
  purgedOutbox: number;
  purgedFailed: number;
  purgedRecipients: number;
}

export async function purgeEmailLog(): Promise<EmailPurgeResult> {
  const policy = await getSetting("email.policy");
  if (!policy) {
    throw new DomainRuleError("email.policy is not configured; expected the seeded retention/retry policy before purging");
  }
  const cronRun = await prisma.cronRun.create({ data: { name: "email-log-purge" } });
  try {
    const cutoff = new Date(Date.now() - policy.retentionDays * MILLIS_PER_DAY);
    const failedCutoff = new Date(Date.now() - FAILED_TRAIL_RETENTION_DAYS * MILLIS_PER_DAY);
    const purgedOutbox = await prisma.outboxMessage.deleteMany({
      where: { status: "SENT", createdAt: { lt: cutoff } },
    });
    const purgedFailed = await prisma.outboxMessage.deleteMany({
      where: { status: "FAILED", createdAt: { lt: failedCutoff } },
    });
    const purgedRecipients = await prisma.emailCampaignRecipient.deleteMany({
      where: { status: { in: ["SENT", "SKIPPED"] }, createdAt: { lt: cutoff } },
    });

    const message = `purged ${purgedOutbox.count} sent outbox row(s), ${purgedFailed.count} failed row(s) older than ${FAILED_TRAIL_RETENTION_DAYS}d, and ${purgedRecipients.count} campaign recipient row(s) older than ${policy.retentionDays}d`;
    await prisma.cronRun.update({
      where: { id: cronRun.id },
      data: { status: "OK", finishedAt: new Date(), message },
    });
    return { cronRunId: cronRun.id, purgedOutbox: purgedOutbox.count, purgedFailed: purgedFailed.count, purgedRecipients: purgedRecipients.count };
  } catch (error) {
    await prisma.cronRun.update({
      where: { id: cronRun.id },
      data: { status: "FAILED", finishedAt: new Date(), message: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}
