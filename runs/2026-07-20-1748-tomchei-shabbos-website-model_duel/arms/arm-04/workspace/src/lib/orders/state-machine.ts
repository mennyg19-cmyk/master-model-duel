import type { OrderStatus } from '@prisma/client';

import { failure, ok, type Result } from '../core/result';

export const ILLEGAL_TRANSITION = 'illegal_order_transition';

/**
 * The only moves an order may make (R-044).
 *
 * A discarded draft and a cancelled order are different things on purpose: a
 * draft that was never placed leaves no order number behind, while a cancelled
 * order keeps its number and its history because money may have moved.
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ['PLACED', 'DISCARDED'],
  PLACED: ['IN_FULFILLMENT', 'CANCELLED'],
  IN_FULFILLMENT: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  DISCARDED: [],
};

/**
 * The stages at which an order can still take money (R-127, R-169).
 *
 * Being packed is not the same as being paid for: the counter posts cash
 * against an order already in the queue, and a card webhook delayed or retried
 * by the provider lands after staff have moved the order on. Payability is
 * about the order still being open, never about which stage it reached — every
 * caller that takes or checks money reads this list so the two cannot drift.
 */
const PAYABLE_STATUSES: readonly OrderStatus[] = ['PLACED', 'IN_FULFILLMENT'];

export function isPayableOrderStatus(status: OrderStatus): boolean {
  return PAYABLE_STATUSES.includes(status);
}

const READABLE_STATUS: Record<OrderStatus, string> = {
  DRAFT: 'still a draft',
  PLACED: 'placed',
  IN_FULFILLMENT: 'being packed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  DISCARDED: 'discarded',
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function checkOrderTransition(from: OrderStatus, to: OrderStatus): Result<null> {
  if (canTransitionOrder(from, to)) return ok(null);

  return failure(
    ILLEGAL_TRANSITION,
    `An order that is ${READABLE_STATUS[from]} cannot become ${READABLE_STATUS[to]}.`,
  );
}
