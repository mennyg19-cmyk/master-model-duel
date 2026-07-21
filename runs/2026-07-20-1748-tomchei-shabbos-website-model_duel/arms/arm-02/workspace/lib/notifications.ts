import type { NotificationChannel, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// Captured-notification outbox (P9). No email/SMS provider exists until P11,
// so every send lands as a CAPTURED Notification row — visible, countable, and
// already deduped, so P11 only swaps the delivery layer.

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
};

/** Returns true when captured, false when the dedupeKey already existed. */
export async function captureNotification(
  input: NotificationInput,
  tx: Prisma.TransactionClient = db
): Promise<boolean> {
  try {
    await tx.notification.create({ data: { ...input, status: "captured" } });
    return true;
  } catch (error) {
    // P2002 on dedupeKey = this exact notification already went out.
    if ((error as { code?: string }).code === "P2002") return false;
    throw error;
  }
}

/**
 * Notify a customer on every channel they can receive: email always, SMS when
 * a phone number is on file (G-021 default channel = email + SMS).
 */
export async function notifyCustomer(
  customer: { id: string; email: string; phone: string | null },
  message: { kind: string; subject: string; body: string; dedupeKey: string; orderId?: string; packageId?: string },
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
        body: message.body,
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
