import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { brandTokens, getEmailBranding, renderTemplate } from "@/lib/email/render";
import { deliverMessage } from "@/lib/email/dispatch";
import { getSetting } from "@/lib/settings";
import { recordAudit, AuditContextLike } from "@/lib/audit";

// R-083/R-089: campaign lifecycle. Drafts edit freely; "send" snapshots the
// list membership into recipient rows (@@unique [campaignId, subscriberId])
// and drains the pending ones through the same dispatcher as the outbox.
// Reruns are safe by construction: the snapshot is createMany-skipDuplicates
// and SENT recipients are never claimable again, so a double send click or a
// retried request can never re-deliver (S2).

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
// campaign_test), then one immediate dispatch attempt — the row lands in the
// same log the sweep drains, which keeps test traffic honest (S5).
export async function testSendCampaign(campaignId: string, toAddress: string): Promise<{ outboxId: string; delivered: boolean; lastError: string | null }> {
  const campaign = await getCampaignOrThrow(campaignId);
  const branding = await getEmailBranding();
  const tokens = brandTokens(branding, { customerName: "Test Recipient" });
  const rendered = renderCampaignPreview(campaign, tokens);
  const row = await prisma.outboxMessage.create({
    data: {
      kind: "campaign_test",
      channel: "EMAIL",
      toAddress,
      subject: `[test] ${rendered.subject}`,
      body: rendered.body,
      metadata: { campaignId },
    },
  });
  try {
    const outcome = await deliverMessage(row);
    await prisma.outboxMessage.update({
      where: { id: row.id },
      data: { status: "SENT", attempts: 1, lastAttemptAt: new Date(), providerId: outcome.providerId, sentAt: new Date() },
    });
    return { outboxId: row.id, delivered: true, lastError: null };
  } catch (error) {
    const lastError = error instanceof Error ? error.message : String(error);
    await prisma.outboxMessage.update({
      where: { id: row.id },
      data: { status: "FAILED", attempts: 1, lastAttemptAt: new Date(), lastError },
    });
    return { outboxId: row.id, delivered: false, lastError };
  }
}

export interface CampaignSendResult {
  campaignId: string;
  snapshotted: number;
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
  // (upsert no-op on rerun — the unique pair is the no-duplicates law).
  // Unsubscribed members are recorded SKIPPED so the send set is provable.
  const members = await prisma.emailListMembership.findMany({
    where: { listId: campaign.listId },
    include: { subscriber: true },
  });
  await prisma.$transaction(async (tx) => {
    for (const member of members) {
      await tx.emailCampaignRecipient.upsert({
        where: { campaignId_subscriberId: { campaignId: campaign.id, subscriberId: member.subscriberId } },
        update: {},
        create: {
          campaignId: campaign.id,
          subscriberId: member.subscriberId,
          email: member.subscriber.email,
          status: member.subscriber.unsubscribedAt ? "SKIPPED" : "PENDING",
        },
      });
    }
    await tx.emailCampaign.update({ where: { id: campaign.id }, data: { status: "SENDING" } });
  });

  const branding = await getEmailBranding();
  const pending = await prisma.emailCampaignRecipient.findMany({
    where: { campaignId: campaign.id, status: { in: ["PENDING", "FAILED"] }, attempts: { lt: policy.maxAttempts } },
    orderBy: { createdAt: "asc" },
  });

  let sent = 0;
  let failed = 0;
  for (const recipient of pending) {
    // Same one-claim discipline as the outbox sweeper: overlapping send
    // passes can never take the same recipient.
    const claim = await prisma.emailCampaignRecipient.updateMany({
      where: { id: recipient.id, status: { in: ["PENDING", "FAILED"] } },
      data: { status: "SENDING", attempts: { increment: 1 } },
    });
    if (claim.count === 0) continue;

    const tokens = brandTokens(branding, { customerName: recipient.email });
    const rendered = renderCampaignPreview(campaign, tokens);
    try {
      const outcome = await deliverMessage({
        channel: "EMAIL",
        toAddress: recipient.email,
        subject: rendered.subject,
        body: rendered.body,
      });
      await prisma.emailCampaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "SENT", providerId: outcome.providerId, sentAt: new Date(), lastError: null },
      });
      sent += 1;
    } catch (error) {
      const lastError = error instanceof Error ? error.message : String(error);
      await prisma.emailCampaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "FAILED", lastError },
      });
      failed += 1;
    }
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

  const skipped = members.filter((member) => member.subscriber.unsubscribedAt).length;
  const alreadySent = await prisma.emailCampaignRecipient.count({
    where: { campaignId: campaign.id, status: "SENT" },
  });
  await recordAudit({
    ctx: input.ctx,
    action: "email_campaign_send",
    targetType: "EmailCampaign",
    targetId: campaign.id,
    metadata: { name: campaign.name, listId: campaign.listId, snapshotted: members.length, skipped, sent, failed },
  });

  return {
    campaignId: campaign.id,
    snapshotted: members.length,
    skipped,
    sent,
    failed,
    alreadySent,
    status: finalStatus,
  };
}
