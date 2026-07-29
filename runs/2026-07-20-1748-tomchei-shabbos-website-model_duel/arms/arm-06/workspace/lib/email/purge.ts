import { prisma } from "@/lib/db";
import { DomainRuleError } from "@/lib/errors";
import { MILLIS_PER_DAY } from "@/lib/dates";
import { getSetting } from "@/lib/settings";

// R-172: the email-log purge. Eligible = SENT outbox rows and SENT/SKIPPED
// campaign recipients older than retentionDays. NEVER eligible: PENDING or
// SENDING rows (the active outbox), FAILED rows (the auditable failure
// trail), and AuditLog/CronRun rows (audit evidence). The CronRun message is
// the durable record of what each purge removed.
export interface EmailPurgeResult {
  cronRunId: string;
  purgedOutbox: number;
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
    const purgedOutbox = await prisma.outboxMessage.deleteMany({
      where: { status: "SENT", createdAt: { lt: cutoff } },
    });
    const purgedRecipients = await prisma.emailCampaignRecipient.deleteMany({
      where: { status: { in: ["SENT", "SKIPPED"] }, createdAt: { lt: cutoff } },
    });

    const message = `purged ${purgedOutbox.count} sent outbox row(s) and ${purgedRecipients.count} campaign recipient row(s) older than ${policy.retentionDays}d`;
    await prisma.cronRun.update({
      where: { id: cronRun.id },
      data: { status: "OK", finishedAt: new Date(), message },
    });
    return { cronRunId: cronRun.id, purgedOutbox: purgedOutbox.count, purgedRecipients: purgedRecipients.count };
  } catch (error) {
    await prisma.cronRun.update({
      where: { id: cronRun.id },
      data: { status: "FAILED", finishedAt: new Date(), message: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}
