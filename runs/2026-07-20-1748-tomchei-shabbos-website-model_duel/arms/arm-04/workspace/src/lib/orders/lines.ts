import type { Prisma } from '@prisma/client';

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

/** How many things are in a box, for a row that says "3 item(s)". */
export function sumLineQuantities(lines: { quantity: number }[]): number {
  return lines.reduce((count, line) => count + line.quantity, 0);
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

/**
 * The chosen options as one readable phrase — "Large, Dairy". The snapshot is
 * JSON because what a product asks changes between seasons, so anything reading
 * it has to survive a shape it does not recognise.
 */
export function optionsLabel(snapshot: Prisma.JsonValue): string {
  if (!Array.isArray(snapshot)) return '';

  return snapshot
    .map((entry) =>
      entry && typeof entry === 'object' && 'label' in entry ? String(entry.label) : '',
    )
    .filter(Boolean)
    .join(', ');
}
