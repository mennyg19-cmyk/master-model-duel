import { AuditAction, CampaignStatus, NotifyChannel, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { err, ok, type Result } from "@/lib/result";
import { enqueueNotification, writeEmailLog } from "@/lib/notify/outbox";
import { getEmailMode, resendSend, defaultFromAddress } from "@/lib/resend/client";
import { getSetting } from "@/lib/settings";
import { STORE_SETTINGS } from "@/lib/storefront/settings-keys";
import { mintUnsubscribeToken } from "@/lib/storefront/newsletter";
import { appUrl } from "@/lib/stripe/client";
import { escapeHtml } from "@/lib/email/templates";

type CampaignRecipient = {
  email: string;
  subscriberId: string;
  tokenVersion: number;
};

export async function createCampaign(input: {
  name: string;
  subject: string;
  htmlBody: string;
  listId?: string | null;
  createdById?: string | null;
}) {
  return db.emailCampaign.create({
    data: {
      name: input.name,
      subject: input.subject,
      htmlBody: input.htmlBody,
      listId: input.listId ?? null,
      createdById: input.createdById ?? null,
      status: CampaignStatus.DRAFT,
    },
  });
}

export async function listCampaigns() {
  return db.emailCampaign.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      list: { select: { id: true, name: true } },
      _count: { select: { deliveries: true } },
    },
  });
}

export async function previewCampaign(campaignId: string) {
  const campaign = await db.emailCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return err("missing", "Campaign not found.");
  return ok({
    id: campaign.id,
    subject: campaign.subject,
    htmlBody: campaign.htmlBody,
    name: campaign.name,
  });
}

export async function testSendCampaign(input: {
  campaignId: string;
  to: string;
  actorId?: string | null;
}): Promise<Result<{ providerId?: string; captured: boolean }>> {
  const campaign = await db.emailCampaign.findUnique({ where: { id: input.campaignId } });
  if (!campaign) return err("missing", "Campaign not found.");

  const fromSetting = await getSetting<{ address?: string }>(STORE_SETTINGS.emailFrom);
  const from = fromSetting?.address?.trim() || defaultFromAddress();
  const mode = getEmailMode();
  const recipientKey = input.to.trim().toLowerCase();

  if (mode === "capture") {
    await writeEmailLog({
      channel: NotifyChannel.EMAIL,
      templateKey: `campaign.test:${campaign.id}`,
      recipientKey,
      subject: campaign.subject,
      body: campaign.htmlBody,
      status: "captured",
      campaignId: campaign.id,
    });
    await writeAudit({
      action: AuditAction.EMAIL_TEST_SENT,
      actorId: input.actorId,
      meta: { campaignId: campaign.id, to: recipientKey, captured: true },
    });
    return ok({ captured: true });
  }

  const sendResult = await resendSend({
    to: recipientKey,
    from,
    subject: `[TEST] ${campaign.subject}`,
    html: campaign.htmlBody,
  });
  if (!sendResult.ok) return err("send", sendResult.error || "Test send failed.");

  await writeEmailLog({
    channel: NotifyChannel.EMAIL,
    templateKey: `campaign.test:${campaign.id}`,
    recipientKey,
    subject: campaign.subject,
    body: campaign.htmlBody,
    status: sendResult.captured ? "captured" : "sent",
    providerId: sendResult.providerId,
    campaignId: campaign.id,
  });
  await writeAudit({
    action: AuditAction.EMAIL_TEST_SENT,
    actorId: input.actorId,
    meta: {
      campaignId: campaign.id,
      to: recipientKey,
      providerId: sendResult.providerId,
      captured: Boolean(sendResult.captured),
    },
  });
  return ok({ providerId: sendResult.providerId, captured: Boolean(sendResult.captured) });
}

async function resolveRecipients(campaign: {
  listId: string | null;
}): Promise<CampaignRecipient[]> {
  if (!campaign.listId) {
    const all = await db.newsletterSubscriber.findMany({
      where: { unsubscribedAt: null },
      select: { id: true, email: true, tokenVersion: true },
    });
    return all.map((s) => ({
      email: s.email,
      subscriberId: s.id,
      tokenVersion: s.tokenVersion,
    }));
  }
  const members = await db.mailingListMember.findMany({
    where: { listId: campaign.listId, subscriber: { unsubscribedAt: null } },
    include: {
      subscriber: { select: { id: true, email: true, tokenVersion: true } },
    },
  });
  return members.map((m) => ({
    email: m.subscriber.email,
    subscriberId: m.subscriber.id,
    tokenVersion: m.subscriber.tokenVersion,
  }));
}

function appendPrefsFooter(htmlBody: string, recipient: CampaignRecipient): string {
  const token = mintUnsubscribeToken(recipient.subscriberId, recipient.tokenVersion);
  const base = appUrl();
  const prefsHref = escapeHtml(
    `${base}/newsletter/preferences?token=${encodeURIComponent(token)}`,
  );
  const unsubHref = escapeHtml(
    `${base}/newsletter/unsubscribe?token=${encodeURIComponent(token)}`,
  );
  return `${htmlBody}<hr /><p style="font-size:12px;color:#666"><a href="${prefsHref}">Email preferences</a> · <a href="${unsubHref}">Unsubscribe</a></p>`;
}

/** Send campaign; reruns skip existing (campaignId, recipient) deliveries (R-083). */
export async function sendCampaign(input: {
  campaignId: string;
  actorId?: string | null;
}): Promise<Result<{ created: number; skipped: number; total: number }>> {
  const campaign = await db.emailCampaign.findUnique({ where: { id: input.campaignId } });
  if (!campaign) return err("missing", "Campaign not found.");

  const recipients = await resolveRecipients(campaign);
  let created = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    const recipientKey = recipient.email.trim().toLowerCase();
    const idempotencyKey = `campaign:${campaign.id}:${recipientKey}`;
    const htmlBody = appendPrefsFooter(campaign.htmlBody, recipient);
    try {
      const delivery = await db.emailCampaignDelivery.create({
        data: {
          campaignId: campaign.id,
          recipientKey,
          idempotencyKey,
          status: "queued",
        },
      });
      const outbox = await enqueueNotification({
        channel: NotifyChannel.EMAIL,
        templateKey: `campaign:${campaign.id}`,
        recipientKey,
        idempotencyKey,
        subject: campaign.subject,
        body: htmlBody,
        meta: { campaignId: campaign.id, deliveryId: delivery.id } as Prisma.InputJsonValue,
        actorId: input.actorId,
      });
      await db.emailCampaignDelivery.update({
        where: { id: delivery.id },
        data: {
          outboxId: outbox.row.id,
          status: outbox.row.status === "CAPTURED" ? "captured" : "queued",
        },
      });
      created += 1;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        skipped += 1;
        continue;
      }
      throw error;
    }
  }

  await db.emailCampaign.update({
    where: { id: campaign.id },
    data: {
      status: CampaignStatus.SENT,
      sentAt: campaign.sentAt ?? new Date(),
    },
  });
  await writeAudit({
    action: AuditAction.EMAIL_CAMPAIGN_SENT,
    actorId: input.actorId,
    meta: {
      campaignId: campaign.id,
      created,
      skipped,
      total: recipients.length,
    },
  });

  return ok({ created, skipped, total: recipients.length });
}

export async function createMailingList(input: {
  name: string;
  description?: string;
  subscriberIds?: string[];
}) {
  return db.mailingList.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      members: input.subscriberIds?.length
        ? {
            create: input.subscriberIds.map((subscriberId) => ({ subscriberId })),
          }
        : undefined,
    },
    include: { members: true },
  });
}

export async function listMailingLists() {
  return db.mailingList.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { members: true } } },
  });
}

export async function addListMembers(listId: string, subscriberIds: string[]) {
  let added = 0;
  for (const subscriberId of subscriberIds) {
    try {
      await db.mailingListMember.create({ data: { listId, subscriberId } });
      added += 1;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        continue;
      }
      throw error;
    }
  }
  return { added };
}
