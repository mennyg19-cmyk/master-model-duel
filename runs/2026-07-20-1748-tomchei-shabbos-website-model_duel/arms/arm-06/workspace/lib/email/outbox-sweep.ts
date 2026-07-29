import { prisma } from "@/lib/db";
import { DomainRuleError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { getEmailBranding } from "@/lib/email/render";
import { claimOutboxRow, deliverClaimedRow, STALE_CLAIM_MS } from "@/lib/email/claim-deliver";
import { CAMPAIGN_OUTBOX_KIND, TEST_OUTBOX_KINDS } from "@/lib/notify/outbox";

// R-088/R-181: the retrying outbox sweeper. Producers only write PENDING
// rows; this is the single place rows meet a provider on a schedule. Claim
// discipline lives in lib/email/claim-deliver.ts (shared with the campaign
// loop and the test sends) — two overlapping sweeps can never claim the same
// row, and a stale claim from a crashed sweeper recovers without burning a
// retry.
const SWEEP_BATCH = 100;

// Kinds the sweep must NOT auto-retry after failure: campaign recipients
// (their retry path is the explicit campaign rerun, so the operator controls
// a mass re-mail) and test sends (a failed test is answered to the operator
// inline; silently re-mailing it minutes later reads as a ghost send).
const NO_SWEEP_RETRY_KINDS: string[] = [CAMPAIGN_OUTBOX_KIND, ...TEST_OUTBOX_KINDS];

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
    const branding = await getEmailBranding();
    const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
    const candidates = await prisma.outboxMessage.findMany({
      where: {
        OR: [
          { status: "PENDING" },
          { status: "FAILED", attempts: { lt: policy.maxAttempts }, kind: { notIn: NO_SWEEP_RETRY_KINDS } },
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
      if (!(await claimOutboxRow(id, policy.maxAttempts, staleBefore))) continue; // an overlapping owner holds this row
      claimed += 1;
      const delivery = await deliverClaimedRow(id, branding);
      if (delivery.outcome === "sent") {
        sent += 1;
        if (delivery.captured) captured += 1;
      } else {
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
