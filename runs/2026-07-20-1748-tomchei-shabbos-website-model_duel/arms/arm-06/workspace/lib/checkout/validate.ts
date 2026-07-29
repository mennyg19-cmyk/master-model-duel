import { OrderLine, Prisma } from "@prisma/client";

// R-034: stock + price validation at checkout. The draft's stored snapshots
// are re-derived from the live catalog; any drift is a 409 conflict with the
// fresh totals, never a silent charge of a stale amount. The client sends an
// expectedTotalCents expectation only — every number is recomputed here, so a
// tampered total fails the same check.
export interface PriceConflict {
  lineId: string;
  productName: string;
  storedCents: number;
  freshCents: number;
}

export interface StockIssue {
  productName: string;
  requested: number;
  available: number;
}

export interface CheckoutConflictReport {
  priceConflicts: PriceConflict[];
  stockIssues: StockIssue[];
  expectedTotalCents: number;
  freshSubtotalCents: number;
  freshFeesCents: number;
  freshTotalCents: number;
}

export class CheckoutConflictError extends Error {
  constructor(public readonly report: CheckoutConflictReport) {
    super("Checkout totals changed since the draft was saved");
    this.name = "CheckoutConflictError";
  }
}

// Returns the fresh subtotal (line items only, before fees) plus the conflict
// report's first two sections. Stock availability is measured against live
// inventory rows; the caller releases this order's own reservation first on
// a re-submit, so the order never competes with itself.
export async function repriceAndCheckStock(
  tx: Prisma.TransactionClient,
  lines: OrderLine[],
): Promise<{ freshSubtotalCents: number; priceConflicts: PriceConflict[]; stockIssues: StockIssue[] }> {
  const productIds = [...new Set(lines.map((line) => line.productId).filter((id): id is string => !!id))];
  const addOnIds = [...new Set(lines.map((line) => line.addOnId).filter((id): id is string => !!id))];
  const optionValueIds = [...new Set(lines.map((line) => line.optionValueId).filter((id): id is string => !!id))];

  const [products, addOns, optionValues] = await Promise.all([
    tx.product.findMany({ where: { id: { in: productIds } }, include: { inventoryItem: true } }),
    tx.addOn.findMany({ where: { id: { in: addOnIds } }, include: { inventoryItem: true } }),
    tx.productOptionValue.findMany({ where: { id: { in: optionValueIds } } }),
  ]);
  const productMap = new Map(products.map((product) => [product.id, product]));
  const addOnMap = new Map(addOns.map((addOn) => [addOn.id, addOn]));
  const optionValueMap = new Map(optionValues.map((value) => [value.id, value]));

  const priceConflicts: PriceConflict[] = [];
  let freshSubtotalCents = 0;
  const neededByProduct = new Map<string, number>();
  const neededByAddOn = new Map<string, number>();

  for (const line of lines) {
    let freshUnitCents: number | null = null;
    if (line.productId) {
      const product = productMap.get(line.productId);
      // A catalog row deleted or deactivated mid-draft reprices as a conflict
      // rather than passing through the stale snapshot.
      if (product && product.active) {
        const freshDelta = line.optionValueId
          ? (optionValueMap.get(line.optionValueId)?.priceDeltaCents ?? 0)
          : 0;
        freshUnitCents = product.basePriceCents + freshDelta;
      }
      neededByProduct.set(line.productId, (neededByProduct.get(line.productId) ?? 0) + line.qty);
    } else if (line.addOnId) {
      const addOn = addOnMap.get(line.addOnId);
      if (addOn && addOn.active) freshUnitCents = addOn.priceCents;
      neededByAddOn.set(line.addOnId, (neededByAddOn.get(line.addOnId) ?? 0) + line.qty);
    }

    if (freshUnitCents === null) {
      priceConflicts.push({
        lineId: line.id,
        productName: line.productName,
        storedCents: line.lineTotalCents,
        freshCents: 0,
      });
      continue;
    }
    const freshLineCents = line.qty * freshUnitCents;
    freshSubtotalCents += freshLineCents;
    if (freshLineCents !== line.lineTotalCents) {
      priceConflicts.push({
        lineId: line.id,
        productName: line.productName,
        storedCents: line.lineTotalCents,
        freshCents: freshLineCents,
      });
    }
  }

  const stockIssues: StockIssue[] = [];
  for (const [productId, needed] of neededByProduct) {
    const product = productMap.get(productId);
    if (!product || !product.active || !product.trackInventory || product.allowBackorder) continue;
    const available = product.inventoryItem
      ? product.inventoryItem.onHand - product.inventoryItem.reserved
      : 0;
    if (needed > available) {
      stockIssues.push({ productName: product.name, requested: needed, available });
    }
  }
  for (const [addOnId, needed] of neededByAddOn) {
    const addOn = addOnMap.get(addOnId);
    if (!addOn || !addOn.active || !addOn.inventoryItem) continue;
    const available = addOn.inventoryItem.onHand - addOn.inventoryItem.reserved;
    if (needed > available) {
      stockIssues.push({ productName: addOn.name, requested: needed, available });
    }
  }

  return { freshSubtotalCents, priceConflicts, stockIssues };
}
