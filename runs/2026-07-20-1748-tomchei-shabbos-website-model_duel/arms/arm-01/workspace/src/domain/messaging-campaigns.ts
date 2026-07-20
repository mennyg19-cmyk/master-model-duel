import { randomUUID } from "node:crypto";
import { MessageChannel, MessageStatus, Prisma, type PrismaClient } from "@prisma/client";
import { defaultEmailLists } from "@/domain/messaging-configuration";
import { enqueueMessage } from "@/domain/messaging-outbox";
import { brandedHtml } from "@/domain/messaging-templates";

const preferenceFields = new Set(
  defaultEmailLists.map((list) => list.preferenceField),
);

function subscriberFilter(preferenceField: string) {
  if (!preferenceFields.has(preferenceField as never)) {
    throw new Error(`Unknown subscriber preference field ${preferenceField}.`);
  }
  return {
    isSubscribed: true,
    [preferenceField]: true,
  };
}

export async function queueCampaign(prisma: PrismaClient, campaignId: string) {
  const campaign = await prisma.emailCampaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { emailList: true },
  });
  const subscribers = await prisma.newsletterSubscriber.findMany({
    where: subscriberFilter(campaign.emailList.preferenceField),
    orderBy: { email: "asc" },
  });
  const eventKey = `campaign:${campaign.id}`;

  await prisma.$transaction(async (transaction) => {
    await transaction.messageOutbox.createMany({
      data: subscribers.map((subscriber) => ({
        idempotencyKey: `${eventKey}:${subscriber.id}`,
        channel: MessageChannel.EMAIL,
        eventKey,
        recipient: subscriber.email,
        subject: campaign.subject,
        htmlBody: brandedHtml(campaign.htmlBody),
        textBody: campaign.textBody,
        payload: {
          campaignId: campaign.id,
          subscriberId: subscriber.id,
        } satisfies Prisma.InputJsonValue,
        campaignId: campaign.id,
      })),
      skipDuplicates: true,
    });
    const outstanding = await transaction.messageOutbox.count({
      where: {
        campaignId: campaign.id,
        eventKey,
        status: {
          in: [
            MessageStatus.PENDING,
            MessageStatus.PROCESSING,
            MessageStatus.FAILED,
          ],
        },
      },
    });
    await transaction.emailCampaign.update({
      where: { id: campaign.id },
      data:
        outstanding === 0
          ? { status: "SENT", sentAt: campaign.sentAt ?? new Date() }
          : { status: "SENDING", sentAt: null },
    });
  });
  return subscribers.length;
}

export async function queueCampaignTest(
  prisma: PrismaClient,
  campaignId: string,
  recipient: string,
) {
  const campaign = await prisma.emailCampaign.findUniqueOrThrow({
    where: { id: campaignId },
  });
  await enqueueMessage(prisma, {
    idempotencyKey: `campaign-test:${campaign.id}:${randomUUID()}`,
    channel: MessageChannel.EMAIL,
    eventKey: `campaign-test:${campaign.id}`,
    recipient,
    subject: `[TEST] ${campaign.subject}`,
    htmlBody: brandedHtml(campaign.htmlBody),
    textBody: campaign.textBody,
    payload: { campaignId: campaign.id, test: true },
    campaignId: campaign.id,
  });
  await prisma.emailCampaign.update({
    where: { id: campaign.id },
    data: { testSentAt: new Date() },
  });
}
