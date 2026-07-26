import 'server-only';

import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { availableUnits } from '../orders/cart';
import { db } from '../db';
import { formatCents } from '../core/money';
import { inventoryDemand, inventoryTargetKey, type InventoryDemand } from '../inventory/demand';

/**
 * What changed under a cart while it was being built (R-034).
 *
 * A draft can sit for a week. In that time an administrator can re-price a box,
 * take one off sale, or the last one on the shelf can go into somebody else's
 * order. Checkout re-reads the catalog and the shelf every time it renders and
 * every time it is asked to charge, so the price on the screen is a price the
 * database still agrees with.
 */
export type ConflictKind = 'price' | 'stock' | 'unavailable';

export type CheckoutConflict = {
  lineId: string;
  itemName: string;
  kind: ConflictKind;
  message: string;
};

const optionsSnapshotSchema = z.array(
  z.object({ groupLabel: z.string(), label: z.string(), priceAdjustmentCents: z.number().int() }),
);

const VALIDATION_INCLUDE = {
  product: {
    select: {
      id: true,
      name: true,
      isActive: true,
      priceCents: true,
      tracksInventory: true,
      options: { select: { groupLabel: true, label: true, priceAdjustmentCents: true } },
      inventory: { select: { onHand: true, reserved: true } },
    },
  },
  addOns: {
    include: {
      addOn: {
        select: {
          id: true,
          name: true,
          isActive: true,
          priceCents: true,
          tracksInventory: true,
          inventory: { select: { onHand: true, reserved: true } },
        },
      },
    },
  },
} satisfies Prisma.OrderLineInclude;

type ValidationLine = Prisma.OrderLineGetPayload<{ include: typeof VALIDATION_INCLUDE }>;

export async function findCheckoutConflicts(orderId: string): Promise<CheckoutConflict[]> {
  const lines = await db.orderLine.findMany({
    where: { orderId },
    include: VALIDATION_INCLUDE,
    orderBy: { createdAt: 'asc' },
  });

  return [...priceConflicts(lines), ...stockConflicts(lines)];
}

function priceConflicts(lines: ValidationLine[]): CheckoutConflict[] {
  const conflicts: CheckoutConflict[] = [];

  for (const line of lines) {
    if (!line.product.isActive) {
      conflicts.push(conflict(line, 'unavailable', `${line.productNameSnapshot} is no longer on sale.`));
      continue;
    }

    const current = currentUnitPrice(line);
    if (current === null) {
      conflicts.push(
        conflict(line, 'unavailable', `One of the choices on ${line.productNameSnapshot} is no longer offered.`),
      );
      continue;
    }

    if (current !== line.unitPriceCents) {
      conflicts.push(
        conflict(
          line,
          'price',
          `${line.productNameSnapshot} is now ${formatCents(current)}, not ${formatCents(line.unitPriceCents)}.`,
        ),
      );
    }

    for (const addOn of line.addOns) {
      if (!addOn.addOn.isActive) {
        conflicts.push(conflict(line, 'unavailable', `${addOn.addOnNameSnapshot} is no longer available.`));
      } else if (addOn.addOn.priceCents !== addOn.unitPriceCents) {
        conflicts.push(
          conflict(
            line,
            'price',
            `${addOn.addOnNameSnapshot} is now ${formatCents(addOn.addOn.priceCents)}, not ${formatCents(addOn.unitPriceCents)}.`,
          ),
        );
      }
    }
  }

  return conflicts;
}

/**
 * Stock is counted across the whole order, not line by line: three lines of the
 * same box are three claims on one shelf, and a draft holds none of it until
 * finalize reserves it. Counted by the same function finalize reserves with, so
 * a warning the customer was not given cannot become an error at the till.
 */
function stockConflicts(lines: ValidationLine[]): CheckoutConflict[] {
  const conflicts: CheckoutConflict[] = [];
  const demand = inventoryDemand(lines);
  const reported = new Set<string>();

  for (const line of lines) {
    const productKey = inventoryTargetKey({ productId: line.productId });
    const productShortfall = shortfall(
      demand,
      productKey,
      line.product.tracksInventory ? availableUnits(line.product.inventory) : null,
    );

    if (productShortfall !== null && !reported.has(productKey)) {
      reported.add(productKey);
      conflicts.push(conflict(line, 'stock', stockMessage(line.productNameSnapshot, productShortfall)));
    }

    for (const addOn of line.addOns) {
      const key = inventoryTargetKey({ addOnId: addOn.addOnId });
      const addOnShortfall = shortfall(
        demand,
        key,
        addOn.addOn.tracksInventory ? availableUnits(addOn.addOn.inventory) : null,
      );

      if (addOnShortfall !== null && !reported.has(key)) {
        reported.add(key);
        conflicts.push(conflict(line, 'stock', stockMessage(addOn.addOnNameSnapshot, addOnShortfall)));
      }
    }
  }

  return conflicts;
}

function shortfall(
  demand: Map<string, InventoryDemand>,
  key: string,
  available: number | null,
): { wanted: number; available: number } | null {
  if (available === null) return null;

  const wanted = demand.get(key)?.quantity ?? 0;
  return wanted > available ? { wanted, available } : null;
}

function stockMessage(itemName: string, counts: { wanted: number; available: number }): string {
  return counts.available === 0
    ? `${itemName} sold out while this order was open.`
    : `Only ${counts.available} ${itemName} left, and this order asks for ${counts.wanted}.`;
}

/** Null when a picked option has since been removed from the product. */
function currentUnitPrice(line: ValidationLine): number | null {
  const snapshot = optionsSnapshotSchema.safeParse(line.optionsSnapshot);
  if (!snapshot.success) return null;

  let price = line.product.priceCents;

  for (const picked of snapshot.data) {
    const offered = line.product.options.find(
      (option) => option.groupLabel === picked.groupLabel && option.label === picked.label,
    );
    if (!offered) return null;
    price += offered.priceAdjustmentCents;
  }

  return price;
}

function conflict(line: ValidationLine, kind: ConflictKind, message: string): CheckoutConflict {
  return { lineId: line.id, itemName: line.productNameSnapshot, kind, message };
}
