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
const OUTBOX_SWEEP_BATCH = 100;
const OUTBOX_LEASE_MS = 2 * 60 * 1000;
const MAX_DELIVERY_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 1_000;

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
    create: input as typeof input & { recipient: string },
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
  campaignId: string | null;
  eventKey: string;
  attempts: number;
};

async function claimMessages(
  prisma: PrismaClient,
  workerId: string,
  limit: number,
) {
  const lockedUntil = new Date(Date.now() + OUTBOX_LEASE_MS);
  return prisma.$queryRaw<ClaimedMessage[]>(Prisma.sql`
    UPDATE "MessageOutbox"
    SET "status" = 'PROCESSING', "lockedAt" = NOW(), "lockedUntil" = ${lockedUntil},
        "lockedBy" = ${workerId}, "updatedAt" = NOW()
    WHERE "id" IN (
      SELECT "id"
      FROM "MessageOutbox"
      WHERE (
        ("status" = 'PENDING' AND "nextAttemptAt" <= NOW())
        OR (
          "status" = 'PROCESSING'
          AND (
            "lockedUntil" <= NOW()
            OR (
              "lockedUntil" IS NULL
              AND "lockedAt" <= NOW() - INTERVAL '2 minutes'
            )
          )
        )
      )
      ORDER BY "createdAt", "id"
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING "id", "idempotencyKey", "channel", "recipient", "subject",
      "htmlBody", "textBody", "payload", "customerId", "packageId",
      "campaignId", "eventKey", "attempts"
  `);
}

async function finalizeCampaignIfDelivered(
  transaction: Prisma.TransactionClient,
  message: ClaimedMessage,
) {
  if (
    !message.campaignId ||
    message.eventKey !== `campaign:${message.campaignId}`
  ) {
    return;
  }
  const remaining = await transaction.messageOutbox.count({
    where: {
      campaignId: message.campaignId,
      eventKey: message.eventKey,
      status: {
        in: [
          MessageStatus.PENDING,
          MessageStatus.PROCESSING,
          MessageStatus.FAILED,
        ],
      },
    },
  });
  if (remaining === 0) {
    await transaction.emailCampaign.update({
      where: { id: message.campaignId },
      data: { status: "SENT", sentAt: new Date() },
    });
  }
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
        lockedUntil: null,
        lockedBy: null,
        lastError: null,
      },
    });
    await transaction.messageAttempt.upsert({
      where: {
        outboxId_attemptNumber: {
          outboxId: message.id,
          attemptNumber: message.attempts + 1,
        },
      },
      create: {
        outboxId: message.id,
        attemptNumber: message.attempts + 1,
        status,
        providerMessageId,
      },
      update: { status, providerMessageId, errorMessage: null },
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
    await finalizeCampaignIfDelivered(transaction, message);
  });
  return status;
}

async function recordFailedDelivery(
  prisma: PrismaClient,
  message: ClaimedMessage,
  error: unknown,
) {
  const attempts = message.attempts + 1;
  const status =
    attempts >= MAX_DELIVERY_ATTEMPTS
      ? MessageStatus.FAILED
      : MessageStatus.PENDING;
  const errorMessage =
    error instanceof Error ? error.message : "Unknown provider failure.";
  const nextAttemptAt =
    status === MessageStatus.PENDING
      ? new Date(Date.now() + 2 ** attempts * BACKOFF_BASE_MS)
      : undefined;

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.messageAttempt.upsert({
        where: {
          outboxId_attemptNumber: {
            outboxId: message.id,
            attemptNumber: attempts,
          },
        },
        create: {
          outboxId: message.id,
          attemptNumber: attempts,
          status: MessageStatus.FAILED,
          errorMessage,
        },
        update: { status: MessageStatus.FAILED, errorMessage },
      });
      await transaction.messageOutbox.update({
        where: { id: message.id },
        data: {
          status,
          attempts,
          nextAttemptAt,
          lockedAt: null,
          lockedUntil: null,
          lockedBy: null,
          lastError: errorMessage,
        },
      });
    });
  } catch (recordingError) {
    await prisma.messageOutbox.updateMany({
      where: { id: message.id, status: MessageStatus.PROCESSING },
      data: {
        status,
        attempts,
        nextAttemptAt,
        lockedAt: null,
        lockedUntil: null,
        lockedBy: null,
        lastError: `${errorMessage}; audit write failed: ${
          recordingError instanceof Error
            ? recordingError.message
            : "unknown error"
        }`,
      },
    });
  }
}

export async function sweepMessageOutbox(
  prisma: PrismaClient,
  options: { workerId?: string; limit?: number } = {},
) {
  const workerId = options.workerId ?? randomUUID();
  const messages = await claimMessages(
    prisma,
    workerId,
    options.limit ?? OUTBOX_SWEEP_BATCH,
  );
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
        errorSummary:
          error instanceof Error ? error.message : "Outbox sweep failed.",
        finishedAt: new Date(),
      },
    });
    throw error;
  }
}
