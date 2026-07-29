import { prisma } from "@/lib/db";
import { DomainRuleError } from "@/lib/errors";
import { MILLIS_PER_MINUTE } from "@/lib/dates";
import { deliverMessage } from "@/lib/email/dispatch";
import { getSetting } from "@/lib/settings";

// R-088/R-181: the retrying outbox sweeper. Producers only write PENDING
// rows; this is the single place rows meet a provider. Claim is the atomic
// conditional UPDATE per message — two overlapping sweeps can never claim the
// same row (count 0 = the other sweep owns it), which is the S4 one-claim
// law. A SENDING row whose claim went stale (crashed sweeper) becomes
// claimable again after STALE_CLAIM_MS so a crash can never strand a send.
const STALE_CLAIM_MS = 10 * MILLIS_PER_MINUTE;
const SWEEP_BATCH = 100;

export interface OutboxSweepResult {
  cronRunId: string;
  claimed: number;
  sent: number;
  failed: number;
  captured: number;
}

export async function sweepOutbox(): Promise<OutboxSweepResult> {
  const policy = await getSetting("email.policy");
  if (!policy) {
    throw new DomainRuleError("email.policy is not configured; expected the seeded retention/retry policy before sweeping");
  }
  const cronRun = await prisma.cronRun.create({ data: { name: "outbox-sweep" } });
  try {
    const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
    const candidates = await prisma.outboxMessage.findMany({
      where: {
        OR: [
          { status: "PENDING" },
          { status: "FAILED", attempts: { lt: policy.maxAttempts } },
          { status: "SENDING", lastAttemptAt: { lt: staleBefore } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: SWEEP_BATCH,
      select: { id: true },
    });

    let claimed = 0;
    let sent = 0;
    let failed = 0;
    let captured = 0;
    for (const { id } of candidates) {
      const claim = await prisma.outboxMessage.updateMany({
        where: {
          id,
          OR: [
            { status: "PENDING" },
            { status: "FAILED", attempts: { lt: policy.maxAttempts } },
            { status: "SENDING", lastAttemptAt: { lt: staleBefore } },
          ],
        },
        data: { status: "SENDING", attempts: { increment: 1 }, lastAttemptAt: new Date() },
      });
      if (claim.count === 0) continue; // an overlapping sweep owns this row
      claimed += 1;

      const message = await prisma.outboxMessage.findUniqueOrThrow({ where: { id } });
      try {
        const outcome = await deliverMessage(message);
        await prisma.outboxMessage.update({
          where: { id },
          data: { status: "SENT", providerId: outcome.providerId, sentAt: new Date(), lastError: null },
        });
        sent += 1;
        if (outcome.captured) captured += 1;
      } catch (error) {
        const lastError = error instanceof Error ? error.message : String(error);
        await prisma.outboxMessage.update({
          where: { id },
          data: { status: "FAILED", lastError },
        });
        failed += 1;
      }
    }

    const message = `${sent} sent (${captured} captured), ${failed} failed, ${claimed} claimed of ${candidates.length} candidate(s)`;
    await prisma.cronRun.update({
      where: { id: cronRun.id },
      data: { status: "OK", finishedAt: new Date(), message },
    });
    return { cronRunId: cronRun.id, claimed, sent, failed, captured };
  } catch (error) {
    await prisma.cronRun.update({
      where: { id: cronRun.id },
      data: { status: "FAILED", finishedAt: new Date(), message: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}
