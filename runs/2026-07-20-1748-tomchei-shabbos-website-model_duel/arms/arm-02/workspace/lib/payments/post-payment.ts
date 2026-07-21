import { Prisma } from "@prisma/client";
import type { PaymentMethod } from "@prisma/client";
import { db } from "@/lib/db";
import { recalcPaymentStatus } from "@/lib/domain/payment-status";
import { writeAudit } from "@/lib/audit";
import { enqueueRefundEmail } from "@/lib/email/transactional";
import type { StaffContext } from "@/lib/auth/current-user";

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
    // P11: refund notice queues with the ledger row, deduped by refund id.
    await enqueueRefundEmail(
      { orderId: entry.orderId, amountCents: entry.amountCents, stripeRefundId: entry.stripeRefundId },
      tx
    );
    return refund;
  });
}

class RefundConflictError extends Error {}

export type StaffRefundStart = { ok: true; paymentId: string } | { ok: false; error: string };

/**
 * Staff refund, DB-first (no double-refund): the negative row commits BEFORE
 * Stripe is called, holding the unique stripeRefundId slot with a placeholder
 * derived from the stable idempotency key. Two concurrent attempts at the same
 * logical refund collide on that unique key — the loser gets a conflict, never
 * a second refund. The refundable check is scoped to THIS payment intent and
 * re-run inside the transaction, and the audit row commits atomically with it.
 */
export async function beginStaffRefund(entry: {
  orderId: string;
  stripePaymentIntentId: string;
  chargeAmountCents: number;
  amountCents: number;
  idempotencyKey: string;
  note: string;
  staff: StaffContext;
}): Promise<StaffRefundStart> {
  try {
    const payment = await db.$transaction(async (tx) => {
      const refunded = await tx.payment.aggregate({
        where: {
          stripePaymentIntentId: entry.stripePaymentIntentId,
          state: "POSTED",
          amountCents: { lt: 0 },
        },
        _sum: { amountCents: true },
      });
      const refundable = entry.chargeAmountCents + (refunded._sum.amountCents ?? 0);
      if (entry.amountCents > refundable) {
        throw new RefundConflictError(`Only ${refundable} cents remain refundable on this payment`);
      }
      const row = await tx.payment.create({
        data: {
          orderId: entry.orderId,
          method: "STRIPE",
          amountCents: -Math.abs(entry.amountCents),
          note: entry.note,
          stripeRefundId: `pending_${entry.idempotencyKey}`,
          stripePaymentIntentId: entry.stripePaymentIntentId,
        },
      });
      await recalcPaymentStatus(tx, entry.orderId);
      await writeAudit(
        entry.staff,
        {
          action: "payment.refund",
          targetType: "Order",
          targetId: entry.orderId,
          detail: {
            paymentId: row.id,
            stripePaymentIntentId: entry.stripePaymentIntentId,
            amountCents: entry.amountCents,
          },
        },
        tx
      );
      return row;
    });
    return { ok: true, paymentId: payment.id };
  } catch (error) {
    if (error instanceof RefundConflictError) return { ok: false, error: error.message };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "This refund is already in progress or was already issued" };
    }
    throw error;
  }
}

/** Swap the placeholder for Stripe's real refund id once the gateway confirms. */
export async function resolveStaffRefund(paymentId: string, stripeRefundId: string): Promise<void> {
  try {
    const payment = await db.payment.update({ where: { id: paymentId }, data: { stripeRefundId } });
    // Deduped on the real refund id, so a webhook sync of this same refund
    // can never email the customer a second time.
    await enqueueRefundEmail({ orderId: payment.orderId, amountCents: payment.amountCents, stripeRefundId });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // The webhook already recorded this refund under its real id — drop our
      // placeholder row so the ledger holds the refund exactly once.
      await cancelStaffRefund(paymentId);
      return;
    }
    throw error;
  }
}

/** Roll the DB row back when the gateway refused the refund (no money moved). */
export async function cancelStaffRefund(paymentId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const row = await tx.payment.delete({ where: { id: paymentId } });
    await recalcPaymentStatus(tx, row.orderId);
  });
}

export type VoidPaymentResult =
  | { ok: true }
  | { ok: false; reason: "stripe_not_voidable" | "already_voided" };

/**
 * Staff void (UR-011, G-028): the row stays for the books, its money stops
 * counting, and the void is audited in the same transaction. Stripe payments
 * are refunded, never voided — money already moved.
 */
export async function voidPayment(paymentId: string, staff: StaffContext): Promise<VoidPaymentResult> {
  return db.$transaction(async (tx): Promise<VoidPaymentResult> => {
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (payment.method === "STRIPE") return { ok: false, reason: "stripe_not_voidable" };
    if (payment.state === "VOIDED") return { ok: false, reason: "already_voided" };
    await tx.payment.update({
      where: { id: paymentId },
      data: { state: "VOIDED", voidedAt: new Date(), voidedByStaffId: staff.realUser.id },
    });
    await recalcPaymentStatus(tx, payment.orderId);
    await writeAudit(
      staff,
      {
        action: "payment.void",
        targetType: "Order",
        targetId: payment.orderId,
        detail: { paymentId, method: payment.method, amountCents: payment.amountCents },
      },
      tx
    );
    return { ok: true };
  });
}
