import { AuditAction, NotifyChannel, NotifyStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

type DbClient = Prisma.TransactionClient | typeof db;

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
