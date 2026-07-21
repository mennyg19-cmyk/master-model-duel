import { AuditAction, type InventoryItem, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { err, maskError, ok, type Result } from "@/lib/result";

type Tx = Prisma.TransactionClient;

export type ReserveInput = {
  inventoryItemId: string;
  quantity: number;
  actorId?: string | null;
};

async function reserveInTx(
  tx: Tx,
  input: ReserveInput,
): Promise<InventoryItem> {
  if (input.quantity < 1) {
    throw new Error(`Reserve quantity must be >= 1, got ${input.quantity}`);
  }

  const rows = await tx.$executeRaw`
    UPDATE "InventoryItem"
    SET
      reserved = reserved + ${input.quantity},
      version = version + 1,
      "updatedAt" = NOW()
    WHERE id = ${input.inventoryItemId}
      AND ("onHand" - reserved) >= ${input.quantity}
  `;

  if (rows !== 1) {
    throw new Error(
      `Inventory reserve failed for ${input.inventoryItemId}: insufficient stock or concurrent claim`,
    );
  }

  const item = await tx.inventoryItem.findUniqueOrThrow({
    where: { id: input.inventoryItemId },
  });

  await tx.auditLog.create({
    data: {
      action: AuditAction.INVENTORY_RESERVED,
      actorId: input.actorId ?? null,
      meta: {
        inventoryItemId: input.inventoryItemId,
        quantity: input.quantity,
        reserved: item.reserved,
        version: item.version,
      },
    },
  });

  return item;
}

export async function reserveInventory(
  input: ReserveInput,
): Promise<Result<{ item: InventoryItem }>> {
  try {
    const item = await db.$transaction((tx) => reserveInTx(tx, input));
    return ok({ item });
  } catch (error) {
    return err(maskError(error), "Could not reserve inventory.");
  }
}

export async function reserveInventoryWithClient(
  tx: Tx,
  input: ReserveInput,
): Promise<InventoryItem> {
  return reserveInTx(tx, input);
}

export function availableUnits(item: Pick<InventoryItem, "onHand" | "reserved">): number {
  return item.onHand - item.reserved;
}
