import {
  AuditAction,
  NotifyChannel,
  NotifyStatus,
  Prisma,
} from "@prisma/client";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { defaultFromAddress, getEmailMode, resendSend } from "@/lib/resend/client";
import { getSmsMode, smsSend } from "@/lib/notify/sms";
import { getSetting } from "@/lib/settings";
import { STORE_SETTINGS } from "@/lib/storefront/settings-keys";

type DbClient = Prisma.TransactionClient | typeof db;

const EMAIL_LOG_RETENTION_MS = 1000 * 60 * 60 * 24 * 30;
const CLAIM_STALE_MS = 1000 * 60 * 2;

export async function captureNotification(
  input: {
    channel: NotifyChannel;
    templateKey: string;
    recipientKey: string;
    idempotencyKey: string;
    subject?: string;
    body: string;
    meta?: Prisma.InputJsonValue;
    actorId?: string | null;
  },
  client: DbClient = db,
) {
  try {
    const row = await client.notificationOutbox.create({
      data: {
        channel: input.channel,
        templateKey: input.templateKey,
        recipientKey: input.recipientKey,
        idempotencyKey: input.idempotencyKey,
        subject: input.subject ?? null,
        body: input.body,
        status: NotifyStatus.CAPTURED,
        meta: input.meta ?? Prisma.JsonNull,
      },
    });
    await writeAudit(
      {
        action: AuditAction.NOTIFICATION_CAPTURED,
        actorId: input.actorId,
        meta: {
          outboxId: row.id,
          channel: input.channel,
          templateKey: input.templateKey,
          recipientKey: input.recipientKey,
          idempotencyKey: input.idempotencyKey,
        },
      },
      client,
    );
    return { created: true as const, row };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await client.notificationOutbox.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      return { created: false as const, row: existing! };
    }
    throw error;
  }
}

export async function captureEmailAndSms(input: {
  templateKey: string;
  recipientKey: string;
  idempotencyBase: string;
  emailSubject: string;
  emailBody: string;
  smsBody: string;
  meta?: Prisma.InputJsonValue;
  actorId?: string | null;
}) {
  const email = await captureNotification({
    channel: NotifyChannel.EMAIL,
    templateKey: input.templateKey,
    recipientKey: input.recipientKey,
    idempotencyKey: `${input.idempotencyBase}:email`,
    subject: input.emailSubject,
    body: input.emailBody,
    meta: input.meta,
    actorId: input.actorId,
  });
  const sms = await captureNotification({
    channel: NotifyChannel.SMS,
    templateKey: input.templateKey,
    recipientKey: input.recipientKey,
    idempotencyKey: `${input.idempotencyBase}:sms`,
    body: input.smsBody,
    meta: input.meta,
    actorId: input.actorId,
  });
  return { email, sms };
}

function initialStatus(channel: NotifyChannel): NotifyStatus {
  if (channel === NotifyChannel.EMAIL) {
    return getEmailMode() === "capture" ? NotifyStatus.CAPTURED : NotifyStatus.PENDING;
  }
  return getSmsMode() === "capture" ? NotifyStatus.CAPTURED : NotifyStatus.PENDING;
}

/** Enqueue for send or immediate capture (R-088 / R-178). Idempotent on key. */
export async function enqueueNotification(
  input: {
    channel: NotifyChannel;
    templateKey: string;
    recipientKey: string;
    idempotencyKey: string;
    subject?: string;
    body: string;
    meta?: Prisma.InputJsonValue;
    actorId?: string | null;
    forceCapture?: boolean;
  },
  client: DbClient = db,
) {
  const status = input.forceCapture ? NotifyStatus.CAPTURED : initialStatus(input.channel);
  try {
    const row = await client.notificationOutbox.create({
      data: {
        channel: input.channel,
        templateKey: input.templateKey,
        recipientKey: input.recipientKey,
        idempotencyKey: input.idempotencyKey,
        subject: input.subject ?? null,
        body: input.body,
        status,
        nextAttemptAt: status === NotifyStatus.PENDING ? new Date() : null,
        meta: input.meta ?? Prisma.JsonNull,
      },
    });
    if (status === NotifyStatus.CAPTURED) {
      await writeAudit(
        {
          action: AuditAction.NOTIFICATION_CAPTURED,
          actorId: input.actorId,
          meta: {
            outboxId: row.id,
            channel: input.channel,
            templateKey: input.templateKey,
            idempotencyKey: input.idempotencyKey,
          },
        },
        client,
      );
      await writeEmailLog({
        channel: input.channel,
        templateKey: input.templateKey,
        recipientKey: input.recipientKey,
        subject: input.subject,
        body: input.body,
        status: "captured",
        outboxId: row.id,
        meta: input.meta,
      });
    }
    return { created: true as const, row };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await client.notificationOutbox.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      return { created: false as const, row: existing! };
    }
    throw error;
  }
}

export async function writeEmailLog(input: {
  channel: NotifyChannel;
  templateKey: string;
  recipientKey: string;
  subject?: string | null;
  body: string;
  status: string;
  providerId?: string | null;
  outboxId?: string | null;
  campaignId?: string | null;
  meta?: Prisma.InputJsonValue;
  purgeAfter?: Date;
}) {
  return db.emailLog.create({
    data: {
      channel: input.channel,
      templateKey: input.templateKey,
      recipientKey: input.recipientKey,
      subject: input.subject ?? null,
      body: input.body,
      status: input.status,
      providerId: input.providerId ?? null,
      outboxId: input.outboxId ?? null,
      campaignId: input.campaignId ?? null,
      meta: input.meta ?? Prisma.JsonNull,
      purgeAfter: input.purgeAfter ?? new Date(Date.now() + EMAIL_LOG_RETENTION_MS),
    },
  });
}

async function resolveFromAddress(): Promise<string> {
  const setting = await getSetting<{ address?: string }>(STORE_SETTINGS.emailFrom);
  if (setting?.address?.trim()) return setting.address.trim();
  return defaultFromAddress();
}

async function resolveReplyTo(): Promise<string | undefined> {
  const setting = await getSetting<{ address?: string }>(STORE_SETTINGS.emailReplyTo);
  return setting?.address?.trim() || undefined;
}

/** Atomically claim one pending/failed-retryable outbox row. */
export async function claimOutboxMessage(workerId: string) {
  const now = new Date();
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS);

  return db.$transaction(async (tx) => {
    const candidates = await tx.notificationOutbox.findMany({
      where: {
        OR: [
          {
            status: NotifyStatus.PENDING,
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          {
            status: NotifyStatus.FAILED,
            attempts: { lt: 5 },
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          {
            status: NotifyStatus.CLAIMED,
            claimedAt: { lt: staleBefore },
          },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 8,
    });

    for (const candidate of candidates) {
      const updated = await tx.notificationOutbox.updateMany({
        where: {
          id: candidate.id,
          status: { in: [NotifyStatus.PENDING, NotifyStatus.FAILED, NotifyStatus.CLAIMED] },
          OR: [
            { claimedAt: null },
            { claimedAt: { lt: staleBefore } },
            { status: { in: [NotifyStatus.PENDING, NotifyStatus.FAILED] } },
          ],
        },
        data: {
          status: NotifyStatus.CLAIMED,
          claimedAt: now,
          claimedBy: workerId,
        },
      });
      if (updated.count === 1) {
        return tx.notificationOutbox.findUniqueOrThrow({ where: { id: candidate.id } });
      }
    }
    return null;
  });
}

async function deliverClaimed(row: {
  id: string;
  channel: NotifyChannel;
  templateKey: string;
  recipientKey: string;
  subject: string | null;
  body: string;
  attempts: number;
  maxAttempts: number;
  meta: Prisma.JsonValue;
}) {
  if (row.channel === NotifyChannel.EMAIL) {
    const from = await resolveFromAddress();
    const replyTo = await resolveReplyTo();
    const result = await resendSend({
      to: row.recipientKey,
      from,
      subject: row.subject ?? row.templateKey,
      html: row.body,
      replyTo,
    });
    return result;
  }

  const result = await smsSend({ to: row.recipientKey, body: row.body });
  return result;
}

export async function processClaimedMessage(rowId: string) {
  const row = await db.notificationOutbox.findUnique({ where: { id: rowId } });
  if (!row || row.status !== NotifyStatus.CLAIMED) {
    return { processed: false as const };
  }

  const result = await deliverClaimed(row);
  if (result.ok) {
    const status = result.captured ? NotifyStatus.CAPTURED : NotifyStatus.SENT;
    const log = await writeEmailLog({
      channel: row.channel,
      templateKey: row.templateKey,
      recipientKey: row.recipientKey,
      subject: row.subject,
      body: row.body,
      status: result.captured ? "captured" : "sent",
      providerId: result.providerId,
      outboxId: row.id,
      meta: row.meta ?? undefined,
    });
    await db.notificationOutbox.update({
      where: { id: row.id },
      data: {
        status,
        sentAt: new Date(),
        providerId: result.providerId ?? null,
        emailLogId: log.id,
        lastError: null,
        claimedAt: null,
        claimedBy: null,
        attempts: { increment: 1 },
      },
    });
    await writeAudit({
      action: result.captured
        ? AuditAction.NOTIFICATION_CAPTURED
        : AuditAction.NOTIFICATION_SENT,
      meta: {
        outboxId: row.id,
        providerId: result.providerId,
        templateKey: row.templateKey,
        captured: Boolean(result.captured),
      },
    });
    return { processed: true as const, status };
  }

  const attempts = row.attempts + 1;
  const exhausted = attempts >= row.maxAttempts;
  const backoffMs = Math.min(1000 * 60 * 30, 1000 * Math.pow(2, attempts));
  await db.notificationOutbox.update({
    where: { id: row.id },
    data: {
      status: NotifyStatus.FAILED,
      attempts,
      lastError: result.error ?? "send failed",
      nextAttemptAt: exhausted ? null : new Date(Date.now() + backoffMs),
      claimedAt: null,
      claimedBy: null,
    },
  });
  await writeAudit({
    action: AuditAction.NOTIFICATION_FAILED,
    meta: {
      outboxId: row.id,
      error: result.error,
      attempts,
      exhausted,
      templateKey: row.templateKey,
    },
  });
  return { processed: true as const, status: NotifyStatus.FAILED, error: result.error };
}

/** Sweep pending outbox with overlap-safe claims (R-088, R-181). */
export async function sweepOutbox(input?: { workerId?: string; limit?: number }) {
  const workerId = input?.workerId ?? `worker_${randomBytes(6).toString("hex")}`;
  const limit = input?.limit ?? 25;
  let claimed = 0;
  let sent = 0;
  let failed = 0;
  let captured = 0;

  for (let i = 0; i < limit; i++) {
    const row = await claimOutboxMessage(workerId);
    if (!row) break;
    claimed += 1;
    const outcome = await processClaimedMessage(row.id);
    if (!outcome.processed) continue;
    if (outcome.status === NotifyStatus.SENT) sent += 1;
    else if (outcome.status === NotifyStatus.CAPTURED) captured += 1;
    else if (outcome.status === NotifyStatus.FAILED) failed += 1;
  }

  return { workerId, claimed, sent, failed, captured };
}
