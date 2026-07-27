import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function reserveInventory(
  inventoryItemId: string,
  quantity: number,
  orderId?: string,
) {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("Inventory reservation quantity must be a positive whole number.");
  }

  return prisma.$transaction(async (transaction) => {
    const reserved = await transaction.$queryRaw<{ id: string }[]>(
      Prisma.sql`
        UPDATE "InventoryItem"
        SET "quantityReserved" = "quantityReserved" + ${quantity}, "version" = "version" + 1
        WHERE "id" = ${inventoryItemId}
          AND "isActive" = true
          AND "quantityOnHand" - "quantityReserved" >= ${quantity}
        RETURNING "id"
      `,
    );
    if (reserved.length !== 1) return false;

    await transaction.inventoryReservation.create({
      data: { inventoryItemId, quantity, orderId },
    });
    return true;
  });
}
