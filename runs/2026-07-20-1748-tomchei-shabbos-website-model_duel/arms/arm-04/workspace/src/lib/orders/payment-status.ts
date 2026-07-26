import 'server-only';

import type { PaymentStatus } from '@prisma/client';

import { db } from '../db';
import type { DbClient } from '../core/db-client';

/**
 * Recomputes the cached payment columns on an order (R-152).
 *
 * The cache exists so the orders list does not sum the payment table once per
 * row. This function is the only writer, and it always recounts from the posted
 * payments and the refunds against them rather than adjusting by a delta, so a
 * voided, refunded or edited payment cannot leave the cache drifting a few
 * dollars off forever.
 *
 * Callers that are already in a transaction pass their client; everyone else
 * gets one, because the recount is only correct while nothing else is posting
 * against the same order.
 */
export async function recomputeOrderPaymentStatus(
  orderId: string,
  client?: DbClient,
): Promise<PaymentStatus> {
  if (client) return recountPayments(client, orderId);
  return db.$transaction((tx) => recountPayments(tx, orderId));
}

async function recountPayments(client: DbClient, orderId: string): Promise<PaymentStatus> {
  // The row lock is what serializes two concurrent postings. Without it both
  // read the same partial set of payments and the second write wins with a
  // total that was already stale when it was computed.
  const locked = await client.$queryRaw<{ totalCents: number }[]>`
    SELECT "totalCents" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;

  const order = locked[0];
  if (!order) throw new Error(`Order ${orderId} no longer exists, so its payment cache cannot be recounted.`);

  const posted = await client.payment.aggregate({
    where: { orderId, state: 'POSTED' },
    _sum: { amountCents: true },
  });

  // Refunds against a voided payment are not counted twice: the void already
  // took the whole payment out of the total above.
  const refunded = await client.paymentRefund.aggregate({
    where: { payment: { orderId, state: 'POSTED' } },
    _sum: { amountCents: true },
  });

  const amountPaidCents = (posted._sum.amountCents ?? 0) - (refunded._sum.amountCents ?? 0);
  const paymentStatus = paymentStatusForAmount(amountPaidCents, order.totalCents);

  await client.order.update({ where: { id: orderId }, data: { amountPaidCents, paymentStatus } });
  return paymentStatus;
}

function paymentStatusForAmount(amountPaidCents: number, totalCents: number): PaymentStatus {
  if (amountPaidCents <= 0) return 'UNPAID';
  if (amountPaidCents < totalCents) return 'PARTIALLY_PAID';
  if (amountPaidCents > totalCents) return 'OVERPAID';
  return 'PAID';
}
