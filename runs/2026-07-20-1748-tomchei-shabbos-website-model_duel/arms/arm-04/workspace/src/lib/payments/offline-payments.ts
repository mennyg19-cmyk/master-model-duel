import 'server-only';

import { randomUUID } from 'node:crypto';

import type { Payment, PaymentMethod, PaymentRefund, Prisma } from '@prisma/client';
import { z } from 'zod';

import { recordAudit } from '../audit';
import type { StaffContext } from '../auth/staff';
import { formatCents } from '../core/money';
import { failure, ok, type Result } from '../core/result';
import { db } from '../db';
import { queueRefundNotice } from '../email/transactional';
import { recomputeOrderPaymentStatus } from '../orders/payment-status';
import { abort, runInTransaction } from '../transaction';
import { getPaymentGateway } from './gateway';

/**
 * Cash, checks and the money that goes back out (UR-011, G-028, R-127).
 *
 * Every function here takes a `StaffContext`, so there is no way to reach one
 * from a customer request — the storefront has no staff context to pass — and
 * the permission is re-checked rather than trusted from the route: "staff only"
 * is a rule about money, not about which page happened to call.
 */
export const OFFLINE_PAYMENT_NOT_ALLOWED = 'offline_payment_not_allowed';
export const PAYMENT_NOT_FOUND = 'payment_not_found';
export const INVALID_PAYMENT_INPUT = 'invalid_payment_input';
export const ORDER_NOT_PAYABLE = 'order_not_payable';

const MAX_PAYMENT_CENTS = 5_000_000;

const offlinePaymentSchema = z.object({
  orderId: z.string().min(1),
  method: z.enum(['CASH', 'CHECK']),
  amountCents: z.number().int().positive('Enter an amount above zero.').max(MAX_PAYMENT_CENTS),
  /** Check number or POS receipt. Never a card number: nothing here takes one. */
  reference: z.string().trim().max(60).optional(),
});

export type OfflinePaymentInput = z.input<typeof offlinePaymentSchema>;

export function isOfflineMethod(method: string): method is 'CASH' | 'CHECK' {
  return method === 'CASH' || method === 'CHECK';
}

export async function postOfflinePayment(
  staff: StaffContext,
  input: OfflinePaymentInput,
): Promise<Result<Payment>> {
  const allowed = requireMoneyPermission(staff);
  if (!allowed.ok) return allowed;

  const parsed = offlinePaymentSchema.safeParse(input);
  if (!parsed.success) return failure(INVALID_PAYMENT_INPUT, parsed.error.issues[0].message);

  const order = await db.order.findUnique({ where: { id: parsed.data.orderId } });
  if (!order) return failure(PAYMENT_NOT_FOUND, 'That order no longer exists.');

  // A draft has no order number, no reserved stock and no agreed total, so
  // taking money against one would be taking it against nothing.
  if (order.status === 'DRAFT' || order.status === 'DISCARDED') {
    return failure(ORDER_NOT_PAYABLE, 'Place the order before taking payment for it.');
  }

  // A cancelled order has handed its stock back and a completed one is finished
  // with. Cash booked against either flips the cached status back to paid with
  // nothing behind it, and no screen would ever show the mistake.
  if (order.status !== 'PLACED' && order.status !== 'IN_FULFILLMENT') {
    return failure(ORDER_NOT_PAYABLE, 'That order is closed, so it cannot take a payment.');
  }

  const outstandingCents = order.totalCents - order.amountPaidCents;
  if (parsed.data.amountCents > outstandingCents) {
    return failure(
      INVALID_PAYMENT_INPUT,
      outstandingCents <= 0
        ? 'This order is already paid in full.'
        : `Only ${formatCents(outstandingCents)} is still owed on this order.`,
    );
  }

  const payment = await db.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        orderId: order.id,
        method: parsed.data.method,
        amountCents: parsed.data.amountCents,
        reference: parsed.data.reference || null,
        recordedByStaffUserId: staff.acting.id,
      },
    });

    await recomputeOrderPaymentStatus(order.id, tx);
    await recordAudit(
      staff,
      {
        action: 'payment.posted',
        entityType: 'Payment',
        entityId: created.id,
        detail: { method: parsed.data.method, amountCents: parsed.data.amountCents },
      },
      tx,
    );

    return created;
  });

  return ok(payment);
}

/**
 * R-160. A mistake is voided, never deleted: the row stays, the reason stays,
 * and the recount treats it as though it never counted.
 */
export async function voidPayment(
  staff: StaffContext,
  input: { paymentId: string; reason: string },
): Promise<Result<Payment>> {
  const allowed = requireMoneyPermission(staff);
  if (!allowed.ok) return allowed;

  const reason = input.reason.trim();
  if (reason === '') return failure(INVALID_PAYMENT_INPUT, 'Say why this payment is being voided.');

  const payment = await db.payment.findUnique({ where: { id: input.paymentId } });
  if (!payment) return failure(PAYMENT_NOT_FOUND, 'That payment no longer exists.');
  if (payment.state === 'VOIDED') return failure(PAYMENT_NOT_FOUND, 'That payment is already voided.');

  const voided = await db.$transaction(async (tx) => {
    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: { state: 'VOIDED', voidedAt: new Date(), voidReason: reason },
    });

    await recomputeOrderPaymentStatus(payment.orderId, tx);
    await recordAudit(
      staff,
      {
        action: 'payment.voided',
        entityType: 'Payment',
        entityId: payment.id,
        detail: { method: payment.method, amountCents: payment.amountCents, reason },
      },
      tx,
    );

    return updated;
  });

  return ok(voided);
}

/**
 * Money handed back on purpose (R-054's staff path, R-168's ledger). A card
 * payment goes through the gateway; cash and checks are returned at the counter
 * and only recorded here.
 */
export async function refundPayment(
  staff: StaffContext,
  input: { paymentId: string; amountCents: number; reason: string },
): Promise<Result<PaymentRefund>> {
  const allowed = requireMoneyPermission(staff);
  if (!allowed.ok) return allowed;

  const reason = input.reason.trim();
  if (reason === '') return failure(INVALID_PAYMENT_INPUT, 'Say why this money is going back.');

  const payment = await db.payment.findUnique({ where: { id: input.paymentId } });
  if (!payment) return failure(PAYMENT_NOT_FOUND, 'That payment no longer exists.');
  if (payment.state === 'VOIDED') {
    return failure(INVALID_PAYMENT_INPUT, 'A voided payment has nothing to refund.');
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return failure(INVALID_PAYMENT_INPUT, 'Enter an amount above zero.');
  }

  return runInTransaction(async (tx) => {
    // Two staff refunding the same payment at the same moment would each read a
    // balance the other is about to spend. The lock is what makes the second one
    // read the first one's refund and be refused.
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${payment.id} FOR UPDATE`;

    const refundable = payment.amountCents - (await refundedSoFar(tx, payment.id));
    if (input.amountCents > refundable) {
      abort(
        failure(
          INVALID_PAYMENT_INPUT,
          `Only ${refundable} cents of this payment can still be refunded.`,
        ),
      );
    }

    const reference = await refundThroughGateway(payment, input.amountCents, reason);

    const created = await tx.paymentRefund.create({
      data: {
        paymentId: payment.id,
        amountCents: input.amountCents,
        reference,
        reason,
        recordedByStaffUserId: staff.acting.id,
      },
    });

    await recomputeOrderPaymentStatus(payment.orderId, tx);
    await queueRefundNotice(
      payment.orderId,
      { refundId: created.id, amountCents: input.amountCents, reason },
      tx,
    );
    await recordAudit(
      staff,
      {
        action: 'payment.refunded',
        entityType: 'Payment',
        entityId: payment.id,
        detail: { amountCents: input.amountCents, reason },
      },
      tx,
    );

    return created;
  });
}

async function refundedSoFar(tx: Prisma.TransactionClient, paymentId: string): Promise<number> {
  const refunded = await tx.paymentRefund.aggregate({
    where: { paymentId },
    _sum: { amountCents: true },
  });

  return refunded._sum.amountCents ?? 0;
}

async function refundThroughGateway(
  payment: Payment,
  amountCents: number,
  reason: string,
): Promise<string | null> {
  if (payment.method !== 'STRIPE' || !payment.reference) return null;

  // A key per call, not per amount: refunding $20 twice is two deliberate acts,
  // and a reused key would hand back the first receipt — whose refund id is
  // already on a row, so the second one would die on the unique index.
  const receipt = await getPaymentGateway().refund({
    paymentIntentId: payment.reference,
    amountCents,
    reason,
    idempotencyKey: `staff-refund-${randomUUID()}`,
  });

  return receipt.refundId;
}

function requireMoneyPermission(staff: StaffContext): Result<null> {
  if (staff.permissions.includes('orders.manage')) return ok(null);

  return failure(
    OFFLINE_PAYMENT_NOT_ALLOWED,
    'Taking or returning money needs the orders permission.',
  );
}

export const OFFLINE_METHOD_LABELS: Record<PaymentMethod, string> = {
  STRIPE: 'Card',
  CASH: 'Cash',
  CHECK: 'Check',
  COMP: 'Comped',
};
