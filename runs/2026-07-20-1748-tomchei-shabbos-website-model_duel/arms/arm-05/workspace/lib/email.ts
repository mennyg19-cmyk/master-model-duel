import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isResendConfigured, sendThroughResend } from "@/lib/resend";

const MAX_OUTBOX_ATTEMPTS = 3;
const OUTBOX_BATCH_SIZE = 25;
const OUTBOX_CLAIM_TIMEOUT_MS = 10 * 60_000;
const OUTBOX_RETRY_DELAY_MS = 60_000;
const EMAIL_LOG_RETENTION_MS = 30 * 24 * 60 * 60_000;

type TransactionalKey = "ORDER_CONFIRMATION" | "PAYMENT_LINK" | "REFUND";

const defaultTemplates: Record<TransactionalKey, { subject: string; body: string }> = {
  ORDER_CONFIRMATION: {
    subject: "Your Tomchei Shabbos order is confirmed",
    body: "<p>Thank you for your order {{orderNumber}}.</p>",
  },
  PAYMENT_LINK: {
    subject: "Complete your Tomchei Shabbos order",
    body: "<p>Your order {{orderNumber}} is ready for payment.</p><p><a href=\"{{paymentLink}}\">Complete payment</a></p>",
  },
  REFUND: {
    subject: "Your Tomchei Shabbos refund",
    body: "<p>Your refund for order {{orderNumber}} has been recorded.</p>",
  },
};

function replaceTemplateVariables(source: string, values: Record<string, string>) {
  return source.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}

export function validateEmailConfiguration() {
  if (process.env.NODE_ENV === "production" && process.env.EMAIL_TEST_MODE === "true") {
    throw new Error("EMAIL_TEST_MODE must be false in production.");
  }
}

validateEmailConfiguration();

function isTestCaptureEnabled() {
  validateEmailConfiguration();
  return process.env.EMAIL_TEST_MODE === "true" || (!isResendConfigured() && process.env.NODE_ENV !== "production");
}

function hasForcedFixtureFailure(payload: Prisma.JsonValue, attemptCount: number) {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    && payload.testFailureOnce === true && attemptCount === 1;
}

async function templateFor(key: TransactionalKey) {
  const fallback = defaultTemplates[key];
  return prisma.emailTemplate.upsert({
    where: { key },
    create: { key, ...fallback, isTransactional: true },
    update: {},
  });
}

export async function ensureDefaultEmailTemplates() {
  await Promise.all((Object.keys(defaultTemplates) as TransactionalKey[]).map(templateFor));
}

export async function queueEmail(input: {
  eventKey: string;
  recipient: string;
  subject: string;
  html: string;
  dedupeKey: string;
  payload?: Prisma.InputJsonValue;
}) {
  return prisma.emailOutbox.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: { ...input, payload: input.payload ?? {} },
    update: {},
  });
}

export async function queueOrderLifecycleEmail(
  orderId: string,
  key: TransactionalKey,
  paymentLink?: string,
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { customer: { select: { emailNormalized: true } } },
  });
  if (!order?.customer?.emailNormalized) return null;

  const template = await templateFor(key);
  const orderNumber = order.orderNumber ? `#${order.orderNumber}` : order.draftReference;
  const values = { orderNumber, paymentLink: paymentLink ?? "" };
  return queueEmail({
    eventKey: key,
    recipient: order.customer.emailNormalized,
    subject: replaceTemplateVariables(template.subject, values),
    html: replaceTemplateVariables(template.body, values),
    dedupeKey: `order:${orderId}:${key}:${key === "PAYMENT_LINK" ? paymentLink ?? "pending" : "current"}`,
    payload: { orderId, key },
  });
}

export async function updateEmailTemplate(input: {
  key: TransactionalKey;
  subject: string;
  body: string;
  branding: Prisma.InputJsonValue;
}) {
  await templateFor(input.key);
  return prisma.emailTemplate.update({
    where: { key: input.key },
    data: { subject: input.subject, body: input.body, branding: input.branding },
  });
}

export async function sendTestEmail(recipient: string) {
  return queueEmail({
    eventKey: "EMAIL_PLATFORM_TEST",
    recipient,
    subject: "Tomchei Shabbos email platform test",
    html: "<p>Your email platform test was captured or sent successfully.</p>",
    dedupeKey: `email-platform-test:${recipient}`,
    payload: { test: true },
  });
}

async function sendOutboxEmail(outbox: {
  recipient: string;
  subject: string;
  html: string;
  dedupeKey: string;
  payload: Prisma.JsonValue;
  attemptCount: number;
}) {
  if (hasForcedFixtureFailure(outbox.payload, outbox.attemptCount)) {
    throw new Error("Forced fixture provider failure.");
  }
  if (isTestCaptureEnabled()) return { provider: "test-capture", externalId: `capture-${Date.now()}` };
  return { provider: "resend", externalId: await sendThroughResend({ ...outbox, idempotencyKey: outbox.dedupeKey }) };
}

export async function sweepEmailOutbox() {
  const now = new Date();
  await prisma.emailOutbox.updateMany({
    where: { status: "PROCESSING", claimedAt: { lt: new Date(now.getTime() - OUTBOX_CLAIM_TIMEOUT_MS) } },
    data: { status: "PENDING", claimedAt: null, attemptCount: { decrement: 1 } },
  });
  const candidates = await prisma.emailOutbox.findMany({
    where: { status: "PENDING", availableAt: { lte: now } },
    orderBy: { createdAt: "asc" },
    take: OUTBOX_BATCH_SIZE,
  });
  let claimed = 0;
  let delivered = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const claim = await prisma.emailOutbox.updateMany({
      where: { id: candidate.id, status: "PENDING", availableAt: { lte: now } },
      data: { status: "PROCESSING", claimedAt: now, attemptCount: { increment: 1 } },
    });
    if (!claim.count) continue;
    claimed += 1;
    const outbox = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: candidate.id } });
    try {
      const delivery = await sendOutboxEmail(outbox);
      const completed = await prisma.$transaction(async (transaction) => {
        const updated = await transaction.emailOutbox.updateMany({
          where: { id: outbox.id, status: "PROCESSING", claimedAt: outbox.claimedAt },
          data: { status: "DELIVERED", sentAt: new Date(), claimedAt: null, lastError: null },
        });
        if (!updated.count) return false;
        await transaction.emailLog.create({
          data: { outboxId: outbox.id, status: "DELIVERED", provider: delivery.provider, details: { externalId: delivery.externalId } },
        });
        return true;
      });
      if (completed) delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email provider failed.";
      const retry = outbox.attemptCount < MAX_OUTBOX_ATTEMPTS;
      const recordedFailure = await prisma.$transaction(async (transaction) => {
        const updated = await transaction.emailOutbox.updateMany({
          where: { id: outbox.id, status: "PROCESSING", claimedAt: outbox.claimedAt },
          data: {
            status: retry ? "PENDING" : "FAILED",
            claimedAt: null,
            availableAt: retry ? new Date(Date.now() + outbox.attemptCount * OUTBOX_RETRY_DELAY_MS) : outbox.availableAt,
            lastError: message,
          },
        });
        if (!updated.count) return false;
        await transaction.emailLog.create({
          data: { outboxId: outbox.id, status: "FAILED", provider: isTestCaptureEnabled() ? "test-capture" : "resend", details: { message, attempt: outbox.attemptCount } },
        });
        return true;
      });
      if (recordedFailure) failed += 1;
    }
  }
  return { claimed, delivered, failed };
}

export async function purgeEmailLogs(before = new Date(Date.now() - EMAIL_LOG_RETENTION_MS)) {
  const deleted = await prisma.emailLog.deleteMany({
    where: {
      createdAt: { lt: before },
      outbox: { status: { in: ["DELIVERED", "FAILED"] } },
    },
  });
  await prisma.auditEvent.create({ data: { action: "email.logs_purged", details: { before: before.toISOString(), deleted: deleted.count } } });
  return deleted.count;
}

export async function createEmailList(name: string) {
  return prisma.emailList.upsert({ where: { name: name.trim() }, create: { name: name.trim() }, update: {} });
}

export async function addSubscriberToEmailList(listId: string, subscriberId: string) {
  return prisma.emailListMember.upsert({
    where: { listId_subscriberId: { listId, subscriberId } },
    create: { listId, subscriberId },
    update: {},
  });
}

export async function createCampaign(input: { name: string; subject: string; body: string; listId?: string }) {
  return prisma.emailCampaign.create({ data: input });
}

export async function sendCampaign(campaignId: string) {
  return prisma.$transaction(async (transaction) => {
    const campaign = await transaction.emailCampaign.findUniqueOrThrow({ where: { id: campaignId } });
    const claimed = await transaction.emailCampaign.updateMany({
      where: { id: campaignId, status: "DRAFT" },
      data: { status: "SENT" },
    });
    if (!claimed.count) return { queued: 0, subscriberCount: 0, alreadySent: true };

    const subscribers = await transaction.newsletterSubscriber.findMany({
      where: {
        confirmedAt: { not: null },
        unsubscribedAt: null,
        ...(campaign.listId ? { listMembers: { some: { listId: campaign.listId } } } : {}),
      },
    });
    let queued = 0;
    for (const subscriber of subscribers) {
      const preferences = subscriber.preferences as { marketing?: boolean };
      if (preferences.marketing === false) continue;
      const message = await transaction.emailOutbox.createMany({
        data: {
          eventKey: "CAMPAIGN",
          recipient: subscriber.email,
          subject: campaign.subject,
          html: campaign.body,
          dedupeKey: `campaign:${campaignId}:${subscriber.id}`,
          payload: { campaignId, subscriberId: subscriber.id },
        },
        skipDuplicates: true,
      });
      if (!message.count) continue;
      await transaction.emailCampaignDelivery.createMany({
        data: { campaignId, subscriberId: subscriber.id },
        skipDuplicates: true,
      });
      queued += message.count;
    }
    if (!queued) {
      await transaction.emailCampaign.update({ where: { id: campaignId }, data: { status: "DRAFT" } });
      return { queued, subscriberCount: subscribers.length };
    }
    await transaction.auditEvent.create({
      data: { action: "email.campaign_sent", subjectId: campaignId, details: { queued, subscriberCount: subscribers.length } },
    });
    return { queued, subscriberCount: subscribers.length };
  });
}

export async function testSendCampaign(campaignId: string, recipient: string) {
  const campaign = await prisma.emailCampaign.findUniqueOrThrow({ where: { id: campaignId } });
  return queueEmail({
    eventKey: "CAMPAIGN_TEST",
    recipient,
    subject: `[Test] ${campaign.subject}`,
    html: campaign.body,
    dedupeKey: `campaign:test:${campaignId}:${recipient}`,
    payload: { campaignId, test: true },
  });
}

export async function emailHub() {
  await ensureDefaultEmailTemplates();
  const [campaigns, templates, lists, outbox] = await Promise.all([
    prisma.emailCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.emailTemplate.findMany({ orderBy: { key: "asc" } }),
    prisma.emailList.findMany({ include: { _count: { select: { members: true } } }, orderBy: { name: "asc" } }),
    prisma.emailOutbox.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
  ]);
  return { campaigns, templates, lists, pendingOutbox: outbox };
}
