import { Prisma, PrismaClient } from "@prisma/client";

export async function reserveInventory(
  prisma: PrismaClient,
  inventoryItemId: string,
  quantity: number,
) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error("Inventory reservation quantity must be a positive integer.");
  }

  return prisma.$transaction(
    async (transaction) => {
      const updatedRows = await transaction.$executeRaw`
        UPDATE "InventoryItem"
        SET "reserved" = "reserved" + ${quantity},
            "version" = "version" + 1,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${inventoryItemId}
          AND "onHand" - "reserved" >= ${quantity}
      `;

      if (updatedRows !== 1) {
        throw new Error("The requested inventory is no longer available.");
      }

      return transaction.inventoryItem.findUniqueOrThrow({
        where: { id: inventoryItemId },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}
