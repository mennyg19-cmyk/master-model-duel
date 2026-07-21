import { AuditAction, CampaignStatus, NotifyChannel, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { err, ok, type Result } from "@/lib/result";
import { enqueueNotification, writeEmailLog } from "@/lib/notify/outbox";
import { getEmailMode, resendSend, defaultFromAddress } from "@/lib/resend/client";
import { getSetting } from "@/lib/settings";
import { STORE_SETTINGS } from "@/lib/storefront/settings-keys";

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

  if (mode === "capture") {
    await writeEmailLog({
      channel: NotifyChannel.EMAIL,
      templateKey: `campaign.test:${campaign.id}`,
      recipientKey: input.to,
      subject: campaign.subject,
      body: campaign.htmlBody,
      status: "captured",
      campaignId: campaign.id,
    });
    await writeAudit({
      action: AuditAction.EMAIL_TEST_SENT,
      actorId: input.actorId,
      meta: { campaignId: campaign.id, to: input.to, captured: true },
    });
    return ok({ captured: true });
  }

  const result = await resendSend({
    to: input.to,
    from,
    subject: `[TEST] ${campaign.subject}`,
    html: campaign.htmlBody,
  });
  if (!result.ok) return err("send", result.error || "Test send failed.");

  await writeEmailLog({
    channel: NotifyChannel.EMAIL,
    templateKey: `campaign.test:${campaign.id}`,
    recipientKey: input.to,
    subject: campaign.subject,
    body: campaign.htmlBody,
    status: result.captured ? "captured" : "sent",
    providerId: result.providerId,
    campaignId: campaign.id,
  });
  await writeAudit({
    action: AuditAction.EMAIL_TEST_SENT,
    actorId: input.actorId,
    meta: {
      campaignId: campaign.id,
      to: input.to,
      providerId: result.providerId,
      captured: Boolean(result.captured),
    },
  });
  return ok({ providerId: result.providerId, captured: Boolean(result.captured) });
}

async function resolveRecipients(campaign: {
  listId: string | null;
}): Promise<string[]> {
  if (!campaign.listId) {
    const all = await db.newsletterSubscriber.findMany({
      where: { unsubscribedAt: null },
      select: { email: true },
    });
    return all.map((s) => s.email);
  }
  const members = await db.mailingListMember.findMany({
    where: { listId: campaign.listId, subscriber: { unsubscribedAt: null } },
    include: { subscriber: { select: { email: true } } },
  });
  return members.map((m) => m.subscriber.email);
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
    const idempotencyKey = `campaign:${campaign.id}:${recipient.toLowerCase()}`;
    try {
      const delivery = await db.emailCampaignDelivery.create({
        data: {
          campaignId: campaign.id,
          recipientKey: recipient,
          idempotencyKey,
          status: "queued",
        },
      });
      const outbox = await enqueueNotification({
        channel: NotifyChannel.EMAIL,
        templateKey: `campaign:${campaign.id}`,
        recipientKey: recipient,
        idempotencyKey,
        subject: campaign.subject,
        body: campaign.htmlBody,
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
