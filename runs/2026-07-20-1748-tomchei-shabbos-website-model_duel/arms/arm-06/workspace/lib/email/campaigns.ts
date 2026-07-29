import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { brandTokens, getEmailBranding, renderTemplate } from "@/lib/email/render";
import { claimOutboxRow, deliverClaimedRow, dispatchOnce, mirrorRecipientFromOutboxRow, STALE_CLAIM_MS, DispatchOnceResult } from "@/lib/email/claim-deliver";
import { getSetting } from "@/lib/settings";
import { recordAudit, AuditContextLike } from "@/lib/audit";
import { CAMPAIGN_OUTBOX_KIND, TEST_OUTBOX_KINDS } from "@/lib/notify/outbox";

// R-083/R-089: campaign lifecycle. Drafts edit freely; "send" snapshots the
// list membership into recipient rows (@@unique [campaignId, subscriberId])
// and drains the pending ones through the shared outbox: every recipient
// gets ONE OutboxMessage delivery row (unique campaignRecipientId), claimed
// and delivered by the same law as every other email — so campaign volume
// lands in the Send log with the rest of the system's mail. Reruns are safe
// by construction: the snapshot is createMany-skipDuplicates, SENT rows are
// never claimable again, and a stale SENDING claim (crashed pass) recovers
// on the next rerun without spending a retry.

export async function getCampaignOrThrow(campaignId: string) {
  const campaign = await prisma.emailCampaign.findUnique({
    where: { id: campaignId },
    include: { list: true },
  });
  if (!campaign) throw new NotFoundError("EmailCampaign", campaignId);
  return campaign;
}

export function renderCampaignPreview(campaign: { subject: string; bodyText: string }, brandingTokens: Record<string, string>) {
  return {
    subject: renderTemplate(campaign.subject, brandingTokens),
    body: renderTemplate(campaign.bodyText, brandingTokens),
  };
}

// Test-send goes through the outbox like any other email (kind
// campaign_test), then one claimed inline dispatch — the row lands in the
// same log the sweep drains, and the claim keeps the sweeper from racing the
// inline attempt into a double delivery.
export async function testSendCampaign(
  campaignId: string,
  toAddress: string,
): Promise<DispatchOnceResult> {
  const campaign = await getCampaignOrThrow(campaignId);
  const branding = await getEmailBranding();
  const tokens = brandTokens(branding, { customerName: "Test Recipient" });
  const rendered = renderCampaignPreview(campaign, tokens);
  const row = await prisma.outboxMessage.create({
    data: {
      kind: TEST_OUTBOX_KINDS[0],
      channel: "EMAIL",
      toAddress,
      subject: `[test] ${rendered.subject}`,
      body: rendered.body,
      metadata: { campaignId },
    },
  });
  return dispatchOnce(row.id, branding);
}

export interface CampaignSendResult {
  campaignId: string;
  totalMembers: number;
  newRecipients: number;
  skipped: number;
  sent: number;
  failed: number;
  alreadySent: number;
  status: "SENT" | "FAILED";
}

export async function sendCampaign(input: {
  campaignId: string;
  ctx: AuditContextLike;
}): Promise<CampaignSendResult> {
  const campaign = await getCampaignOrThrow(input.campaignId);
  const policy = await getSetting("email.policy");
  if (!policy) {
    throw new DomainRuleError("email.policy is not configured; expected the seeded retention/retry policy before sending");
  }

  // Snapshot: every current list member becomes a recipient row exactly once
  // (createMany-skipDuplicates — the unique pair is the no-duplicates law).
  // Unsubscribed members are recorded SKIPPED so the send set is provable.
  // The re-sync passes keep pre-delivery states honest with CURRENT
  // subscription state: a resubscribed member leaves SKIPPED and is reached,
  // a member who unsubscribed since the last run is skipped before mailing.
  const members = await prisma.emailListMembership.findMany({
    where: { listId: campaign.listId },
    include: { subscriber: true },
  });
  const snapshot = await prisma.$transaction(async (tx) => {
    const created = await tx.emailCampaignRecipient.createMany({
      data: members.map((member) => ({
        campaignId: campaign.id,
        subscriberId: member.subscriberId,
        email: member.subscriber.email,
        status: member.subscriber.unsubscribedAt ? ("SKIPPED" as const) : ("PENDING" as const),
      })),
      skipDuplicates: true,
    });
    await tx.emailCampaignRecipient.updateMany({
      where: { campaignId: campaign.id, status: "SKIPPED", subscriber: { unsubscribedAt: null } },
      data: { status: "PENDING" },
    });
    await tx.emailCampaignRecipient.updateMany({
      where: { campaignId: campaign.id, status: "PENDING", subscriber: { unsubscribedAt: { not: null } } },
      data: { status: "SKIPPED" },
    });
    await tx.emailCampaign.update({ where: { id: campaign.id }, data: { status: "SENDING" } });
    return created.count;
  });

  const branding = await getEmailBranding();
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
  const pending = await prisma.emailCampaignRecipient.findMany({
    where: {
      campaignId: campaign.id,
      OR: [
        { status: { in: ["PENDING", "FAILED"] }, attempts: { lt: policy.maxAttempts } },
        { status: "SENDING", lastAttemptAt: { lt: staleBefore } },
      ],
    },
    orderBy: { createdAt: "asc" },
    include: { subscriber: { select: { name: true } } },
  });
  const alreadySent = await prisma.emailCampaignRecipient.count({
    where: { campaignId: campaign.id, status: "SENT" },
  });

  let sent = 0;
  let failed = 0;
  for (const recipient of pending) {
    const tokens = brandTokens(branding, { customerName: recipient.subscriber.name ?? recipient.email });
    const rendered = renderCampaignPreview(campaign, tokens);
    // The delivery outbox row is created once per recipient and reused on
    // every rerun — its attempts/status are the delivery history; the
    // recipient row mirrors it.
    const outboxRow = await prisma.outboxMessage.upsert({
      where: { campaignRecipientId: recipient.id },
      create: {
        kind: CAMPAIGN_OUTBOX_KIND,
        channel: "EMAIL",
        toAddress: recipient.email,
        subject: rendered.subject,
        body: rendered.body,
        campaignRecipientId: recipient.id,
        metadata: { campaignId: campaign.id },
      },
      update: {},
    });
    const claimed = await claimOutboxRow(outboxRow.id, policy.maxAttempts, staleBefore);
    if (!claimed) {
      // Another owner (overlapping rerun, sweeper) holds the delivery — or it
      // finished in the crash gap. Mirror whatever the outbox row settled into.
      const settled = await prisma.outboxMessage.findUnique({ where: { campaignRecipientId: recipient.id } });
      if (settled) await mirrorRecipientFromOutboxRow(settled);
      continue;
    }
    await prisma.emailCampaignRecipient.update({
      where: { id: recipient.id },
      data: { status: "SENDING", lastAttemptAt: new Date() },
    });
    const delivery = await deliverClaimedRow(outboxRow.id, branding);
    if (delivery.outcome === "sent") sent += 1;
    else failed += 1;
  }

  // Status law: FAILED while retryable work remains (PENDING/SENDING rows or
  // FAILED rows under maxAttempts) — a rerun IS the retry path; SENT once the
  // only leftovers are permanently failed (attempts exhausted) or skipped.
  const openWork = await prisma.emailCampaignRecipient.count({
    where: { campaignId: campaign.id, status: { in: ["PENDING", "SENDING"] } },
  });
  const retryable = await prisma.emailCampaignRecipient.count({
    where: { campaignId: campaign.id, status: "FAILED", attempts: { lt: policy.maxAttempts } },
  });
  const permanentFailures = await prisma.emailCampaignRecipient.count({
    where: { campaignId: campaign.id, status: "FAILED", attempts: { gte: policy.maxAttempts } },
  });
  const finalStatus = openWork === 0 && retryable === 0 ? "SENT" : "FAILED";
  await prisma.emailCampaign.update({
    where: { id: campaign.id },
    data: {
      status: finalStatus,
      sentAt: finalStatus === "SENT" ? new Date() : campaign.sentAt,
      lastError:
        retryable > 0
          ? `${retryable} recipient(s) failed — rerun to retry`
          : permanentFailures > 0
            ? `${permanentFailures} recipient(s) failed permanently`
            : null,
    },
  });

  const skipped = await prisma.emailCampaignRecipient.count({
    where: { campaignId: campaign.id, status: "SKIPPED" },
  });
  await recordAudit({
    ctx: input.ctx,
    action: "email_campaign_send",
    targetType: "EmailCampaign",
    targetId: campaign.id,
    metadata: { name: campaign.name, listId: campaign.listId, totalMembers: members.length, newRecipients: snapshot, skipped, sent, failed },
  });

  return {
    campaignId: campaign.id,
    totalMembers: members.length,
    newRecipients: snapshot,
    skipped,
    sent,
    failed,
    alreadySent,
    status: finalStatus,
  };
}
