import {
  AuditAction,
  CachedPaymentStatus,
  OrderStatus,
  PaymentMethod,
  PaymentState,
  type Payment,
  type Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";
import { err, maskError, ok, type Result } from "@/lib/result";
import { assertOrderTransition } from "@/lib/orders/state-machine";
import { finalizeOrder } from "@/lib/orders/finalize";
import { AuthError } from "@/lib/auth";

type Tx = Prisma.TransactionClient;

export function computeCachedPaymentStatus(input: {
  expectedTotalCents: number;
  postedNetCents: number;
}): CachedPaymentStatus {
  const { expectedTotalCents, postedNetCents } = input;
  if (postedNetCents <= 0) return CachedPaymentStatus.UNPAID;
  if (postedNetCents < expectedTotalCents) return CachedPaymentStatus.PARTIAL;
  if (postedNetCents === expectedTotalCents) return CachedPaymentStatus.PAID;
  return CachedPaymentStatus.OVERPAID;
}

export async function recalcOrderPaymentStatus(
  orderId: string,
  tx?: Tx,
): Promise<CachedPaymentStatus> {
  const client = tx ?? db;
  const order = await client.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { payments: true },
  });
  const postedNet = order.payments
    .filter((p) => p.state === PaymentState.POSTED)
    .reduce((sum, p) => sum + (p.amountCents - p.refundedCents), 0);
  const expected = order.expectedTotalCents ?? 0;
  const status = computeCachedPaymentStatus({
    expectedTotalCents: expected,
    postedNetCents: postedNet,
  });
  await client.order.update({
    where: { id: orderId },
    data: { paymentStatusCached: status },
  });
  return status;
}

const OFFLINE_METHODS = new Set<PaymentMethod>([
  PaymentMethod.CASH,
  PaymentMethod.CHECK,
]);

/** Staff-only cash/check POS posting with audit (UR-011, R-127). */
export async function postOfflinePayment(input: {
  orderId: string;
  method: PaymentMethod;
  amountCents: number;
  reference?: string | null;
  staffId: string;
  /** When true, finalize draft → PLACED before posting if still DRAFT. */
  finalizeIfDraft?: boolean;
}): Promise<Result<{ payment: Payment; orderStatus: OrderStatus; paymentStatus: CachedPaymentStatus }>> {
  if (!OFFLINE_METHODS.has(input.method)) {
    return err("method", "Only cash or check allowed for offline POS.");
  }
  if (input.amountCents <= 0) {
    return err("amount", "Payment amount must be positive.");
  }

  try {
    if (input.finalizeIfDraft) {
      const current = await db.order.findUniqueOrThrow({ where: { id: input.orderId } });
      if (current.status === OrderStatus.DRAFT) {
        const finalized = await finalizeOrder(input.orderId, input.staffId);
        if (!finalized.ok) return err(finalized.error, finalized.publicMessage);
      }
    }

    const result = await db.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({
        where: { id: input.orderId },
        include: { payments: true },
      });

      if (order.status === OrderStatus.DRAFT || order.status === OrderStatus.DISCARDED) {
        throw new Error(`Cannot post payment on ${order.status} order`);
      }

      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          method: input.method,
          state: PaymentState.POSTED,
          amountCents: input.amountCents,
          reference: input.reference ?? null,
          postedById: input.staffId,
        },
      });

      await tx.auditLog.create({
        data: {
          action: AuditAction.PAYMENT_POSTED,
          actorId: input.staffId,
          meta: {
            orderId: order.id,
            paymentId: payment.id,
            method: input.method,
            amountCents: input.amountCents,
            reference: input.reference ?? null,
          },
        },
      });

      const paymentStatus = await recalcOrderPaymentStatus(order.id, tx);

      if (
        paymentStatus === CachedPaymentStatus.PAID ||
        paymentStatus === CachedPaymentStatus.OVERPAID
      ) {
        if (order.status === OrderStatus.PLACED) {
          assertOrderTransition(order.status, OrderStatus.PAID);
          await tx.order.update({
            where: { id: order.id },
            data: { status: OrderStatus.PAID, version: { increment: 1 } },
          });
          await tx.auditLog.create({
            data: {
              action: AuditAction.ORDER_PAID,
              actorId: input.staffId,
              meta: { orderId: order.id, via: input.method },
            },
          });
        }
      }

      const refreshed = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
      return { payment, orderStatus: refreshed.status, paymentStatus };
    });

    return ok(result);
  } catch (error) {
    return err(maskError(error), "Could not post offline payment.");
  }
}

export async function voidPayment(input: {
  paymentId: string;
  staffId: string;
  reason?: string | null;
}): Promise<Result<{ payment: Payment; paymentStatus: CachedPaymentStatus }>> {
  try {
    const result = await db.$transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: input.paymentId },
      });
      if (payment.state === PaymentState.VOIDED) {
        throw new Error("Payment already voided");
      }
      if (
        payment.method !== PaymentMethod.CASH &&
        payment.method !== PaymentMethod.CHECK
      ) {
        throw new Error("Only cash/check payments can be voided via POS void");
      }

      const updated = await tx.payment.update({
        where: { id: payment.id },
        data: {
          state: PaymentState.VOIDED,
          voidedById: input.staffId,
          voidedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          action: AuditAction.PAYMENT_VOIDED,
          actorId: input.staffId,
          meta: {
            orderId: payment.orderId,
            paymentId: payment.id,
            amountCents: payment.amountCents,
            reason: input.reason ?? null,
          },
        },
      });

      const paymentStatus = await recalcOrderPaymentStatus(payment.orderId, tx);
      return { payment: updated, paymentStatus };
    });
    return ok(result);
  } catch (error) {
    return err(maskError(error), "Could not void payment.");
  }
}

/** Reject offline methods on public/customer paths (R-127). */
export function assertOfflinePaymentStaffOnly(isStaff: boolean): void {
  if (!isStaff) {
    throw new AuthError(403, "Cash and check payments are staff-only.");
  }
}
