import type { NotificationChannel, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { NotificationStatus } from "@/lib/email/notification-lifecycle";

// Notification outbox (P9 enqueue, P11 delivery). Every send lands as a
// PENDING Notification row inside the caller's transaction; the sweeper cron
// (lib/email/dispatch.ts) delivers it through the real providers with retry.
// Idempotency is unchanged: a colliding dedupeKey is a skipped duplicate.

export type NotificationInput = {
  channel: NotificationChannel;
  recipient: string;
  kind: string;
  subject?: string;
  body: string;
  /** Unique idempotency key: a colliding capture is a skipped duplicate, never a re-send. */
  dedupeKey?: string;
  customerId?: string;
  orderId?: string;
  packageId?: string;
  status?: string;
  claimedAt?: Date;
};

/** Returns true when enqueued, false when the dedupeKey already existed. */
export async function captureNotification(
  input: NotificationInput,
  tx: Prisma.TransactionClient = db
): Promise<boolean> {
  try {
    await tx.notification.create({
      data: {
        ...input,
        status: input.status ?? NotificationStatus.PENDING,
      },
    });
    return true;
  } catch (error) {
    // P2002 on dedupeKey = this exact notification already went out.
    if ((error as { code?: string }).code === "P2002") return false;
    throw error;
  }
}

/** First line, capped for SMS (A-09 fallback when no dedicated smsBody). */
function shortSmsBody(body: string): string {
  const firstLine = body.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? body.trim();
  return firstLine.length <= 160 ? firstLine : `${firstLine.slice(0, 157)}...`;
}

/**
 * Notify a customer on every channel they can receive: email always, SMS when
 * a phone number is on file (G-021 default channel = email + SMS).
 * Pass `smsBody` for a short SMS-specific text; otherwise the first email line
 * is truncated to 160 chars (A-09).
 */
export async function notifyCustomer(
  customer: { id: string; email: string; phone: string | null },
  message: {
    kind: string;
    subject: string;
    body: string;
    smsBody?: string;
    dedupeKey: string;
    orderId?: string;
    packageId?: string;
  },
  tx: Prisma.TransactionClient = db
): Promise<number> {
  let captured = 0;
  const sent = await captureNotification(
    {
      channel: "EMAIL",
      recipient: customer.email,
      kind: message.kind,
      subject: message.subject,
      body: message.body,
      dedupeKey: `${message.dedupeKey}|email`,
      customerId: customer.id,
      orderId: message.orderId,
      packageId: message.packageId,
    },
    tx
  );
  if (sent) captured += 1;
  if (customer.phone) {
    const smsSent = await captureNotification(
      {
        channel: "SMS",
        recipient: customer.phone,
        kind: message.kind,
        body: message.smsBody ?? shortSmsBody(message.body),
        dedupeKey: `${message.dedupeKey}|sms`,
        customerId: customer.id,
        orderId: message.orderId,
        packageId: message.packageId,
      },
      tx
    );
    if (smsSent) captured += 1;
  }
  return captured;
}
