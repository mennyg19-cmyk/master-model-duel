/**
 * How an order's enums are read off a screen.
 *
 * The desk, the detail page and the Today queue all show the same payment
 * status, and each of them had grown its own answer: four badge colours on one
 * screen and two on the next, "Partially paid" here and "partially paid" there
 * and `PARTIALLY_PAID` on the third. Staff comparing two tabs should not have to
 * work out whether they are looking at the same thing.
 */
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

/** Overpaid is red, not green: it is money owed back, not money collected. */
export function paymentStatusTone(status: string): BadgeTone {
  if (status === 'PAID') return 'success';
  if (status === 'OVERPAID') return 'danger';
  if (status === 'PARTIALLY_PAID') return 'warning';
  return 'neutral';
}

export function orderStatusTone(status: string): BadgeTone {
  return status === 'CANCELLED' ? 'danger' : 'neutral';
}

/** `PARTIALLY_PAID` is a database word; "Partially paid" is what a person reads. */
export function humanizeStatus(value: string): string {
  const spaced = value.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * How an order is named on a screen, a printed sheet or a message to the
 * customer. An order that has been placed has a number; a draft has only the
 * reference the customer was given, and quoting a number it does not have yet
 * is how somebody rings up asking about order #0.
 *
 * One casing everywhere, including mid-sentence: five call sites had grown
 * "Order #12" and "order #12", which reads as two different things.
 */
export function formatOrderLabel(order: {
  orderNumber: number | null;
  draftReference: string;
}): string {
  return order.orderNumber === null ? order.draftReference : `Order #${order.orderNumber}`;
}
