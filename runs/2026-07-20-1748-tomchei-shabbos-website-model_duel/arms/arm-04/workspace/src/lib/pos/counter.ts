import 'server-only';

import type { Payment, Season } from '@prisma/client';

import { recordAudit } from '../audit';
import type { StaffContext } from '../auth/staff';
import { readCheckoutSummary } from '../checkout/checkout-summary';
import { failure, ok, type Result } from '../core/result';
import { db } from '../db';
import type { DraftOwner } from '../orders/draft-access';
import { finalizeOrder } from '../orders/order-service';
import { postOfflinePayment } from '../payments/offline-payments';

/**
 * The counter (R-059, R-061, UR-006, UR-011).
 *
 * A POS order is the same order the website would have produced: the same cart,
 * the same grouping, the same fees, the same finalize. What differs is who is
 * holding the mouse, and that shows up in exactly two places — the draft is
 * owned by a till instead of a browser, and payment is cash or a check taken
 * by a named member of staff.
 *
 * The public `store.open` switch is deliberately not consulted. Closing the
 * store stops the website taking orders; it is not an instruction to the office
 * to turn away somebody standing at the desk. The season still has to be open,
 * because a closed season has no catalogue, no stock and no order numbers.
 */
export const COUNTER_CLOSED = 'counter_closed';
export const COUNTER_NO_CART = 'counter_no_cart';
export const COUNTER_NOT_READY = 'counter_not_ready';
export const COUNTER_TOTAL_CHANGED = 'counter_total_changed';

export function posOwner(staff: StaffContext, customerId: string): DraftOwner {
  return { kind: 'pos', staffUserId: staff.acting.id, customerId };
}

export async function openSeasonForCounter(): Promise<Result<Season>> {
  const season = await db.season.findFirst({ where: { status: 'OPEN' }, orderBy: { year: 'desc' } });
  if (!season) {
    return failure(COUNTER_CLOSED, 'No season is open, so there is nothing to sell at the counter.');
  }

  return ok(season);
}

export type CounterSale = { orderId: string; orderNumber: number; payment: Payment };

/**
 * Ring it up: place the order, then take the money for it.
 *
 * Placing first is not an ordering preference — it is what reserves the stock
 * and assigns the number, and `postOfflinePayment` refuses a draft for exactly
 * that reason. If the cash entry then fails the order stays placed and unpaid
 * on the desk, which is the honest state: the boxes are spoken for and somebody
 * owes for them. That half is audited before it is reported, because a member of
 * staff standing at the till with the money is not something the order row says.
 */
export async function sellAtCounter(
  staff: StaffContext,
  input: {
    customerId: string;
    seasonId: string;
    method: 'CASH' | 'CHECK';
    expectedTotalCents: number;
    reference: string;
  },
): Promise<Result<CounterSale>> {
  const owner = posOwner(staff, input.customerId);

  const summary = await readCheckoutSummary(owner, input.seasonId);
  if (!summary) return failure(COUNTER_NO_CART, 'This till has no open order for that customer.');
  if (!summary.isPayable) {
    return failure(
      COUNTER_NOT_READY,
      summary.unassignedCount > 0
        ? `${summary.unassignedCount} item${summary.unassignedCount === 1 ? ' is' : 's are'} still waiting for a recipient.`
        : 'Something in this order changed. Check the notes above and try again.',
    );
  }

  // The same guard the website has (R-034): the amount taken is the amount the
  // screen the staff member read was showing.
  if (input.expectedTotalCents !== summary.totalCents) {
    return failure(COUNTER_TOTAL_CHANGED, 'The total changed. Look it over and ring it up again.');
  }

  const placed = await finalizeOrder(summary.orderId, staff);
  if (!placed.ok) return placed;

  const payment = await postOfflinePayment(staff, {
    orderId: summary.orderId,
    method: input.method,
    amountCents: placed.value.totalCents,
    reference: input.reference,
  });

  if (!payment.ok) {
    await recordAudit(staff, {
      action: 'pos.sale_unpaid',
      entityType: 'Order',
      entityId: summary.orderId,
      detail: {
        orderNumber: placed.value.orderNumber,
        method: input.method,
        code: payment.code,
      },
    });

    return payment;
  }

  return ok({
    orderId: summary.orderId,
    orderNumber: placed.value.orderNumber,
    payment: payment.value,
  });
}
