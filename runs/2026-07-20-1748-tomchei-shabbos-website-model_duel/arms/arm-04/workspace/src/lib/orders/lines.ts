import { sumCents } from '../core/money';

/**
 * The two questions every screen asks about an order line: what does it cost,
 * and does it know where it is going.
 *
 * Both were answered in four places with the same three lines of code. The cost
 * one matters most — checkout, finalize and the account pages all quote it, and
 * a copy that drifts is a total the customer disputes.
 */
export function lineTotalWithAddOns(line: {
  lineTotalCents: number;
  addOns: { lineTotalCents: number }[];
}): number {
  return line.lineTotalCents + sumCents(line.addOns.map((addOn) => addOn.lineTotalCents));
}

type BuildableLine = { recipientName: string | null; fulfillmentMethodId: string | null };

/** A line the assignment step has finished with, so it carries a destination. */
export type AssignedLine<TLine extends BuildableLine> = TLine & {
  recipientName: string;
  fulfillmentMethodId: string;
};

/**
 * Cart-first building means a line can sit in the cart with no recipient yet
 * (UR-006). A CHECK constraint keeps the two columns in step, so either both are
 * set or neither is.
 */
export function isLineAssigned<TLine extends BuildableLine>(
  line: TLine,
): line is AssignedLine<TLine> {
  return line.recipientName !== null && line.fulfillmentMethodId !== null;
}
