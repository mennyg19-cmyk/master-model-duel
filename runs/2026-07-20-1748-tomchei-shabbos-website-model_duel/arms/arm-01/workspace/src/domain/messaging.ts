import { randomUUID } from "node:crypto";
import {
  MessageChannel,
  MessageStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { isEmailTestMode, sendResendEmail } from "@/lib/resend";
import { sendSmsMessage } from "@/lib/sms";

type MessageClient = PrismaClient | Prisma.TransactionClient;
type TemplateVariables = Record<string, string | number>;

const defaultLists = [
  {
    key: "product-updates",
    name: "Product updates",
    preferenceField: "productUpdates",
  },
  {
    key: "volunteer-stories",
    name: "Volunteer stories",
    preferenceField: "volunteerStories",
  },
  {
    key: "community-impact",
    name: "Community impact",
    preferenceField: "communityImpact",
  },
] as const;

const defaultTemplates = [
  {
    key: "newsletter.preferences",
    name: "Newsletter preferences",
    subject: "Manage your Tomchei Shabbos updates",
    htmlBody: "<p>Thanks for subscribing. <a href=\"{{preferenceUrl}}\">Choose which updates you receive</a>.</p>",
    textBody: "Thanks for subscribing. Manage your updates: {{preferenceUrl}}",
  },
  {
    key: "order.confirmation",
    name: "Order confirmation",
    subject: "Order {{orderNumber}} confirmed",
    htmlBody: "<p>Thank you, {{customerName}}. Your order {{orderNumber}} is confirmed.</p>",
    textBody: "Thank you, {{customerName}}. Your order {{orderNumber}} is confirmed.",
  },
  {
    key: "order.payment_link",
    name: "Payment link",
    subject: "Payment reminder for order {{orderNumber}}",
    htmlBody: "<p>Your order {{orderNumber}} still needs payment. <a href=\"{{paymentUrl}}\">Pay securely</a>.</p>",
    textBody: "Your order {{orderNumber}} still needs payment: {{paymentUrl}}",
  },
  {
    key: "order.refund",
    name: "Refund",
    subject: "Refund recorded for order {{orderNumber}}",
    htmlBody: "<p>We recorded a refund of {{refundAmount}} for order {{orderNumber}}.</p>",
    textBody: "We recorded a refund of {{refundAmount}} for order {{orderNumber}}.",
  },
  {
    key: "delivery.day_of",
    name: "Delivery today",
    subject: "Your Purim package is out for delivery",
    htmlBody: "<p>Your package for {{recipientName}} is out for delivery today.</p>",
    textBody: "Your package for {{recipientName}} is out for delivery today.",
  },
  {
    key: "pickup.ready",
    name: "Pickup ready",
    subject: "Your Purim package is ready for pickup",
    htmlBody: "<p>Your package is ready at {{pickupLocation}}.</p>",
    textBody: "Your package is ready at {{pickupLocation}}.",
  },
  {
    key: "delivery.bulk",
    name: "Bulk delivery scheduled",
    subject: "Your delivery is scheduled",
    htmlBody: "<p>Your delivery window is {{deliveryWindow}}.</p>",
    textBody: "Your delivery window is {{deliveryWindow}}.",
  },
] as const;

function renderTemplate(source: string, variables: TemplateVariables) {
  return source.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) =>
    String(variables[key] ?? ""),
  );
}

function brandedHtml(content: string) {
  return `<div style="font-family:Arial,sans-serif;color:#17231d"><div style="border-bottom:4px solid #7a2434;padding:16px 0;font-size:20px;font-weight:700">Tomchei Shabbos</div><main style="padding:24px 0">${content}</main><footer style="border-top:1px solid #ddd;padding-top:16px;color:#66736c">Purim gifts that support local families.</footer></div>`;
}

export async function ensureMessagingConfiguration(prisma: MessageClient) {
  await Promise.all(
    defaultLists.map((list) =>
      prisma.emailList.upsert({
        where: { key: list.key },
        create: list,
        update: {
          name: list.name,
          preferenceField: list.preferenceField,
        },
      }),
    ),
  );
  await Promise.all(
    defaultTemplates.map((template) =>
      prisma.emailTemplate.upsert({
        where: { key: template.key },
        create: template,
        update: {},
      }),
    ),
  );
}

export async function enqueueMessage(
  prisma: MessageClient,
  input: {
    idempotencyKey: string;
    channel: MessageChannel;
    eventKey: string;
    recipient: string | null;
    subject?: string;
    htmlBody?: string;
    textBody: string;
    payload: Prisma.InputJsonValue;
    templateKey?: string;
    customerId?: string;
    orderId?: string;
    packageId?: string;
    campaignId?: string;
  },
) {
  if (!input.recipient) return null;
  const message = await prisma.messageOutbox.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    create: {
      ...input,
      recipient: input.recipient,
    },
    update: {},
  });
  if (isEmailTestMode() && input.customerId) {
    await prisma.notificationCapture.upsert({
      where: {
        eventKey_channel: {
          eventKey: input.eventKey,
          channel: input.channel,
        },
      },
      create: {
        customerId: input.customerId,
        packageId: input.packageId,
        channel: input.channel,
        eventKey: input.eventKey,
        destination: input.recipient,
        payload: input.payload,
      },
      update: {},
    });
  }
  return message;
}

export async function enqueueTransactionalEmail(
  prisma: MessageClient,
  input: {
    idempotencyKey: string;
    templateKey: string;
    recipient: string | null;
    variables: TemplateVariables;
    customerId?: string;
    orderId?: string;
    packageId?: string;
  },
) {
  await ensureMessagingConfiguration(prisma);
  const template = await prisma.emailTemplate.findUniqueOrThrow({
    where: { key: input.templateKey },
  });
  if (!template.isEnabled) return null;
  const subject = renderTemplate(template.subject, input.variables);
  const htmlBody = brandedHtml(renderTemplate(template.htmlBody, input.variables));
  const textBody = renderTemplate(template.textBody, input.variables);
  return enqueueMessage(prisma, {
    idempotencyKey: input.idempotencyKey,
    templateKey: input.templateKey,
    recipient: input.recipient,
    customerId: input.customerId,
    orderId: input.orderId,
    packageId: input.packageId,
    channel: MessageChannel.EMAIL,
    eventKey: input.idempotencyKey,
    subject,
    htmlBody,
    textBody,
    payload: input.variables,
  });
}

function subscriberFilter(preferenceField: string) {
  const base = { isSubscribed: true };
  if (preferenceField === "productUpdates") return { ...base, productUpdates: true };
  if (preferenceField === "volunteerStories") return { ...base, volunteerStories: true };
  if (preferenceField === "communityImpact") return { ...base, communityImpact: true };
  throw new Error(`Unknown subscriber preference field ${preferenceField}.`);
}

export async function queueCampaign(prisma: PrismaClient, campaignId: string) {
  const campaign = await prisma.emailCampaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { emailList: true },
  });
  const subscribers = await prisma.newsletterSubscriber.findMany({
    where: subscriberFilter(campaign.emailList.preferenceField),
    orderBy: { email: "asc" },
    take: 5_000,
  });
  await prisma.emailCampaign.update({
    where: { id: campaign.id },
    data: { status: "SENDING" },
  });
  for (const subscriber of subscribers) {
    await enqueueMessage(prisma, {
      idempotencyKey: `campaign:${campaign.id}:${subscriber.id}`,
      channel: MessageChannel.EMAIL,
      eventKey: `campaign:${campaign.id}`,
      recipient: subscriber.email,
      subject: campaign.subject,
      htmlBody: brandedHtml(campaign.htmlBody),
      textBody: campaign.textBody,
      payload: { campaignId: campaign.id, subscriberId: subscriber.id },
      campaignId: campaign.id,
    });
  }
  await prisma.emailCampaign.update({
    where: { id: campaign.id },
    data: { status: "SENT", sentAt: new Date() },
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

type ClaimedMessage = {
  id: string;
  idempotencyKey: string;
  channel: MessageChannel;
  recipient: string;
  subject: string | null;
  htmlBody: string | null;
  textBody: string;
  payload: Prisma.JsonValue;
  customerId: string | null;
  packageId: string | null;
  eventKey: string;
  attempts: number;
};

async function claimMessages(
  prisma: PrismaClient,
  workerId: string,
  limit: number,
) {
  return prisma.$queryRaw<ClaimedMessage[]>(Prisma.sql`
    UPDATE "MessageOutbox"
    SET "status" = 'PROCESSING', "lockedAt" = NOW(), "lockedBy" = ${workerId},
        "updatedAt" = NOW()
    WHERE "id" IN (
      SELECT "id"
      FROM "MessageOutbox"
      WHERE "status" = 'PENDING' AND "nextAttemptAt" <= NOW()
      ORDER BY "createdAt"
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING "id", "idempotencyKey", "channel", "recipient", "subject",
      "htmlBody", "textBody", "payload", "customerId", "packageId",
      "eventKey", "attempts"
  `);
}

async function recordSuccessfulDelivery(
  prisma: PrismaClient,
  message: ClaimedMessage,
  providerMessageId: string | null,
) {
  const status = isEmailTestMode() ? MessageStatus.CAPTURED : MessageStatus.SENT;
  await prisma.$transaction(async (transaction) => {
    await transaction.messageOutbox.update({
      where: { id: message.id },
      data: {
        status,
        attempts: { increment: 1 },
        providerMessageId,
        sentAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
    });
    await transaction.messageAttempt.create({
      data: {
        outboxId: message.id,
        attemptNumber: message.attempts + 1,
        status,
        providerMessageId,
      },
    });
    if (message.customerId) {
      await transaction.notificationCapture.upsert({
        where: {
          eventKey_channel: {
            eventKey: message.eventKey,
            channel: message.channel,
          },
        },
        create: {
          customerId: message.customerId,
          packageId: message.packageId,
          channel: message.channel,
          eventKey: message.eventKey,
          destination: message.recipient,
          payload: message.payload as Prisma.InputJsonValue,
        },
        update: {},
      });
    }
  });
  return status;
}

async function recordFailedDelivery(
  prisma: PrismaClient,
  message: ClaimedMessage,
  error: unknown,
) {
  const attempts = message.attempts + 1;
  const status = attempts >= 3 ? MessageStatus.FAILED : MessageStatus.PENDING;
  const errorMessage = error instanceof Error ? error.message : "Unknown provider failure.";
  await prisma.$transaction([
    prisma.messageOutbox.update({
      where: { id: message.id },
      data: {
        status,
        attempts,
        nextAttemptAt: new Date(Date.now() + 2 ** attempts * 1_000),
        lockedAt: null,
        lockedBy: null,
        lastError: errorMessage,
      },
    }),
    prisma.messageAttempt.create({
      data: {
        outboxId: message.id,
        attemptNumber: attempts,
        status: MessageStatus.FAILED,
        errorMessage,
      },
    }),
  ]);
}

export async function sweepMessageOutbox(
  prisma: PrismaClient,
  options: { workerId?: string; limit?: number } = {},
) {
  const workerId = options.workerId ?? randomUUID();
  const messages = await claimMessages(prisma, workerId, options.limit ?? 100);
  let succeeded = 0;
  let failed = 0;
  for (const message of messages) {
    try {
      let providerMessageId: string | null = null;
      if (!isEmailTestMode()) {
        providerMessageId =
          message.channel === MessageChannel.EMAIL
            ? await sendResendEmail({
                idempotencyKey: message.idempotencyKey,
                recipient: message.recipient,
                subject: message.subject ?? "Tomchei Shabbos update",
                html: message.htmlBody ?? message.textBody,
                text: message.textBody,
              })
            : await sendSmsMessage({
                idempotencyKey: message.idempotencyKey,
                recipient: message.recipient,
                text: message.textBody,
              });
      }
      await recordSuccessfulDelivery(prisma, message, providerMessageId);
      succeeded++;
    } catch (error) {
      await recordFailedDelivery(prisma, message, error);
      failed++;
    }
  }
  return { workerId, claimed: messages.length, succeeded, failed };
}

export async function runOutboxSweep(prisma: PrismaClient, runKey: string) {
  const priorRun = await prisma.cronRun.findUnique({ where: { runKey } });
  if (priorRun) return priorRun;
  const run = await prisma.cronRun.create({
    data: { jobName: "message-outbox", runKey, status: "RUNNING" },
  });
  try {
    const outcome = await sweepMessageOutbox(prisma);
    return prisma.cronRun.update({
      where: { id: run.id },
      data: {
        status: outcome.failed ? "COMPLETED_WITH_FAILURES" : "COMPLETED",
        claimed: outcome.claimed,
        succeeded: outcome.succeeded,
        failed: outcome.failed,
        finishedAt: new Date(),
      },
    });
  } catch (error) {
    await prisma.cronRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorSummary: error instanceof Error ? error.message : "Outbox sweep failed.",
        finishedAt: new Date(),
      },
    });
    throw error;
  }
}

export async function purgeMessageLogs(
  prisma: PrismaClient,
  cutoff: Date,
  runKey: string,
) {
  const priorRun = await prisma.cronRun.findUnique({ where: { runKey } });
  if (priorRun) return priorRun;
  const run = await prisma.cronRun.create({
    data: { jobName: "message-log-purge", runKey, status: "RUNNING" },
  });
  const [attempts, captures] = await prisma.$transaction([
    prisma.messageAttempt.deleteMany({
      where: {
        attemptedAt: { lt: cutoff },
        outbox: { status: { in: [MessageStatus.SENT, MessageStatus.CAPTURED] } },
      },
    }),
    prisma.notificationCapture.deleteMany({ where: { sentAt: { lt: cutoff } } }),
  ]);
  return prisma.cronRun.update({
    where: { id: run.id },
    data: {
      status: "COMPLETED",
      claimed: attempts.count + captures.count,
      succeeded: attempts.count + captures.count,
      finishedAt: new Date(),
    },
  });
}
