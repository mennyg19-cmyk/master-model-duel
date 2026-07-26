import type { InventoryTarget } from './reserve';

/**
 * What an order asks of the shelf, counted once.
 *
 * Checkout asks it to warn the customer and finalize asks it to take the stock,
 * and the two have to count the same way: two lines carrying the same product
 * for different recipients are one claim of two, not two claims of one.
 */
export type DemandLine = {
  productId: string;
  quantity: number;
  productNameSnapshot: string;
  product: { tracksInventory: boolean };
  addOns: {
    addOnId: string;
    quantity: number;
    addOnNameSnapshot: string;
    addOn: { tracksInventory: boolean };
  }[];
};

export type InventoryDemand = { target: InventoryTarget; quantity: number; itemName: string };

export function inventoryTargetKey(target: InventoryTarget): string {
  return 'productId' in target ? `product:${target.productId}` : `addon:${target.addOnId}`;
}

export function inventoryDemand(lines: DemandLine[]): Map<string, InventoryDemand> {
  const demand = new Map<string, InventoryDemand>();

  const want = (target: InventoryTarget, quantity: number, itemName: string) => {
    const key = inventoryTargetKey(target);
    const existing = demand.get(key);

    if (existing) existing.quantity += quantity;
    else demand.set(key, { target, quantity, itemName });
  };

  for (const line of lines) {
    if (line.product.tracksInventory) {
      want({ productId: line.productId }, line.quantity, line.productNameSnapshot);
    }

    for (const addOn of line.addOns) {
      if (!addOn.addOn.tracksInventory) continue;
      want({ addOnId: addOn.addOnId }, addOn.quantity, addOn.addOnNameSnapshot);
    }
  }

  return demand;
}
