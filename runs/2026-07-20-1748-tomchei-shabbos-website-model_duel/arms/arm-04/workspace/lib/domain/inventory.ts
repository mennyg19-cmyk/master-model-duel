import type { Prisma } from "@prisma/client";

// Reserve engine for the unified inventory (R-158). The conditional UPDATE is
// the whole concurrency story: it only commits when enough unreserved stock
// exists at that instant, so two checkouts racing for the last unit can never
// both succeed. Returns false when stock ran out (caller decides how to fail).
export async function reserveInventory(
  tx: Prisma.TransactionClient,
  inventoryItemId: string,
  quantity: number
): Promise<boolean> {
  if (quantity < 1) throw new Error(`Reservation quantity must be >= 1, got ${quantity}`);
  const updatedCount = await tx.$executeRaw`
    UPDATE "InventoryItem"
    SET "reserved" = "reserved" + ${quantity}, "version" = "version" + 1
    WHERE "id" = ${inventoryItemId}
      AND "quantityOnHand" - "reserved" >= ${quantity}
  `;
  return updatedCount === 1;
}

export async function releaseReservation(
  tx: Prisma.TransactionClient,
  inventoryItemId: string,
  quantity: number
): Promise<void> {
  if (quantity < 1) throw new Error(`Release quantity must be >= 1, got ${quantity}`);
  const updatedCount = await tx.$executeRaw`
    UPDATE "InventoryItem"
    SET "reserved" = "reserved" - ${quantity}, "version" = "version" + 1
    WHERE "id" = ${inventoryItemId} AND "reserved" >= ${quantity}
  `;
  if (updatedCount !== 1) {
    throw new Error(
      `Cannot release ${quantity} from inventory item ${inventoryItemId}: fewer than ${quantity} units are reserved`
    );
  }
}
