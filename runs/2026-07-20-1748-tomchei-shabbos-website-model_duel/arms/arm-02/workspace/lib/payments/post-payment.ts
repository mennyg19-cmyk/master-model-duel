import type { PaymentMethod, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { recalcPaymentStatus } from "@/lib/domain/payment-status";

// All payment writes go through here so every row is followed by a payment-
// status recalc (R-036, R-152) inside the same transaction.

export async function postPayment(entry: {
  orderId: string;
  method: PaymentMethod;
  amountCents: number;
  note?: string;
  stripePaymentIntentId?: string;
  tx?: Prisma.TransactionClient;
}) {
  const run = async (tx: Prisma.TransactionClient) => {
    const payment = await tx.payment.create({
      data: {
        orderId: entry.orderId,
        method: entry.method,
        amountCents: entry.amountCents,
        note: entry.note,
        stripePaymentIntentId: entry.stripePaymentIntentId,
      },
    });
    await recalcPaymentStatus(tx, entry.orderId);
    return payment;
  };
  return entry.tx ? run(entry.tx) : db.$transaction(run);
}

/**
 * Refunds are negative POSTED rows keyed by the Stripe refund id — the unique
 * key makes refund sync idempotent (R-168): replaying the refund event finds
 * the existing row and changes nothing.
 */
export async function recordRefund(entry: {
  orderId: string;
  amountCents: number;
  stripeRefundId: string;
  stripePaymentIntentId?: string;
  note?: string;
}) {
  return db.$transaction(async (tx) => {
    const existing = await tx.payment.findUnique({ where: { stripeRefundId: entry.stripeRefundId } });
    if (existing) return existing;
    const refund = await tx.payment.create({
      data: {
        orderId: entry.orderId,
        method: "STRIPE",
        amountCents: -Math.abs(entry.amountCents),
        note: entry.note ?? "Stripe refund",
        stripeRefundId: entry.stripeRefundId,
        stripePaymentIntentId: entry.stripePaymentIntentId,
      },
    });
    await recalcPaymentStatus(tx, entry.orderId);
    return refund;
  });
}

/** Staff void (UR-011, G-028): the row stays for the audit trail, its money stops counting. */
export async function voidPayment(paymentId: string, staffId: string) {
  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (payment.state === "VOIDED") return payment;
    const voided = await tx.payment.update({
      where: { id: paymentId },
      data: { state: "VOIDED", voidedAt: new Date(), voidedByStaffId: staffId },
    });
    await recalcPaymentStatus(tx, payment.orderId);
    return voided;
  });
}
