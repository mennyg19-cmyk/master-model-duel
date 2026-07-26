/**
 * Where the counter lives. The customer is in the path rather than in a session
 * or a hidden field, so the whole state of a till is the URL — which is what
 * lets a staff member keep two customers open in two tabs (R-059).
 */
export const POS_PATH = '/admin/pos';

export function posBuilderPath(customerId: string): string {
  return `${POS_PATH}/${customerId}`;
}

export function posCheckoutPath(customerId: string): string {
  return `${POS_PATH}/${customerId}/checkout`;
}
