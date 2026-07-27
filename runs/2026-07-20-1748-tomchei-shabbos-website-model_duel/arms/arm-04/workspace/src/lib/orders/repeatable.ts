import type { OrderStatus } from '@prisma/client';

/**
 * Orders worth offering "same as last year" on: a cancelled or discarded order
 * is not a thing anybody wants back, and a draft is already in the cart.
 *
 * One set rather than a filter per screen. The history row, the order page and
 * the repeat itself all ask this question, and three answers is how a cancelled
 * order ends up with no button anywhere and a working `/repeat` URL.
 */
export const REPEATABLE_STATUSES: readonly OrderStatus[] = [
  'PLACED',
  'IN_FULFILLMENT',
  'COMPLETED',
];

export function isRepeatable(status: OrderStatus): boolean {
  return REPEATABLE_STATUSES.includes(status);
}
