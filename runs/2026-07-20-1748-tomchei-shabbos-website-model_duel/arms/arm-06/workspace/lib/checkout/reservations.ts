import { Prisma } from "@prisma/client";
import { releaseStockTx } from "@/lib/inventory/reserve";

// Stock lifecycle shared by drafts (save/cancel release) and checkout (submit
// reserve, finalize commit, expire/safety release). Kept separate from the
// checkout lifecycle modules so drafts.ts can release without a module cycle.

// Aggregate qty per InventoryItem row for an order's lines. Tracked products
// (trackInventory, no backorder bypass) and add-ons with an inventory row
// count; untracked lines reserve nothing. Backorder-allowed products skip
// reservation entirely — their stock is advisory (availableStock semantics).
export async function inventoryNeedsForLines(
  tx: Prisma.TransactionClient,
  lines: { productId: string | null; addOnId: string | null; qty: number }[],
): Promise<Map<string, number>> {
  const productIds = [...new Set(lines.map((line) => line.productId).filter((id): id is string => !!id))];
  const addOnIds = [...new Set(lines.map((line) => line.addOnId).filter((id): id is string => !!id))];
  const [products, addOns] = await Promise.all([
    tx.product.findMany({
      where: { id: { in: productIds }, trackInventory: true, allowBackorder: false },
      select: { id: true, inventoryItem: { select: { id: true } } },
    }),
    tx.addOn.findMany({
      where: { id: { in: addOnIds }, inventoryItem: { isNot: null } },
      select: { id: true, inventoryItem: { select: { id: true } } },
    }),
  ]);
  const productItem = new Map(
    products.flatMap((product) => (product.inventoryItem ? [[product.id, product.inventoryItem.id] as const] : [])),
  );
  const addOnItem = new Map(
    addOns.flatMap((addOn) => (addOn.inventoryItem ? [[addOn.id, addOn.inventoryItem.id] as const] : [])),
  );

  const needs = new Map<string, number>();
  for (const line of lines) {
    const itemId = line.productId ? productItem.get(line.productId) : line.addOnId ? addOnItem.get(line.addOnId) : undefined;
    if (itemId) needs.set(itemId, (needs.get(itemId) ?? 0) + line.qty);
  }
  return needs;
}

// Idempotent: a draft that never reached checkout has nothing to release.
// Clears the Stripe session too — an edited draft must re-submit before any
// session pointing at it could complete.
export async function releaseOrderReservation(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { lines: true } });
  if (!order || !order.stockReserved) return;
  const needs = await inventoryNeedsForLines(tx, order.lines);
  for (const [itemId, qty] of needs) {
    await releaseStockTx(tx, itemId, qty);
  }
  await tx.order.update({
    where: { id: orderId },
    data: { stockReserved: false, stripeSessionId: null },
  });
}
