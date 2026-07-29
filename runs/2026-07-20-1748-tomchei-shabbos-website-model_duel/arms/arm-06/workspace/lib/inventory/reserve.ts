import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";

// R-158: unified stock for products + add-ons (one InventoryItem row per
// target, XOR-enforced in the schema). Reservations take a row-level lock so
// two checkouts for the last unit can never both commit.
export class InsufficientStockError extends Error {
  constructor(inventoryItemId: string, requested: number, available: number) {
    super(`Insufficient stock on ${inventoryItemId}: requested ${requested}, available ${available}`);
    this.name = "InsufficientStockError";
  }
}

function assertPositiveQty(qty: number): void {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new DomainRuleError(`qty must be a positive integer; got ${qty}`);
  }
}

// The checkout engine runs reserve/release/commit inside its own transaction,
// so the row-lock verbs take the tx client. The standalone wrappers below
// keep the P2 call sites unchanged.
export async function reserveStockTx(
  tx: Prisma.TransactionClient,
  inventoryItemId: string,
  qty: number,
): Promise<void> {
  assertPositiveQty(qty);
  const rows = await tx.$queryRaw<{ onHand: number; reserved: number }[]>`
    SELECT "onHand", reserved FROM inventory_items WHERE id = ${inventoryItemId} FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundError("Inventory item", inventoryItemId);
  const { onHand, reserved } = rows[0];
  const available = onHand - reserved;
  if (available < qty) throw new InsufficientStockError(inventoryItemId, qty, available);
  await tx.inventoryItem.update({
    where: { id: inventoryItemId },
    data: { reserved: { increment: qty }, version: { increment: 1 } },
  });
}

export async function releaseStockTx(
  tx: Prisma.TransactionClient,
  inventoryItemId: string,
  qty: number,
): Promise<void> {
  assertPositiveQty(qty);
  const rows = await tx.$queryRaw<{ reserved: number }[]>`
    SELECT reserved FROM inventory_items WHERE id = ${inventoryItemId} FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundError("Inventory item", inventoryItemId);
  if (rows[0].reserved < qty) {
    throw new DomainRuleError(
      `Cannot release ${qty} from ${inventoryItemId}: only ${rows[0].reserved} reserved`,
    );
  }
  await tx.inventoryItem.update({
    where: { id: inventoryItemId },
    data: { reserved: { decrement: qty }, version: { increment: 1 } },
  });
}

// Convert a reservation into a sale: reserved −= qty, onHand −= qty. With no
// reservation (POS direct finalize) the availability check happens here
// instead — the row lock makes both forms race-safe.
export async function commitStockTx(
  tx: Prisma.TransactionClient,
  inventoryItemId: string,
  qty: number,
  wasReserved: boolean,
): Promise<void> {
  assertPositiveQty(qty);
  const rows = await tx.$queryRaw<{ onHand: number; reserved: number }[]>`
    SELECT "onHand", reserved FROM inventory_items WHERE id = ${inventoryItemId} FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundError("Inventory item", inventoryItemId);
  const { onHand, reserved } = rows[0];
  if (wasReserved) {
    if (reserved < qty) {
      throw new DomainRuleError(
        `Cannot commit ${qty} from ${inventoryItemId}: only ${reserved} reserved`,
      );
    }
  } else if (onHand - reserved < qty) {
    throw new InsufficientStockError(inventoryItemId, qty, onHand - reserved);
  }
  await tx.inventoryItem.update({
    where: { id: inventoryItemId },
    data: {
      onHand: { decrement: qty },
      ...(wasReserved ? { reserved: { decrement: qty } } : {}),
      version: { increment: 1 },
    },
  });
}

export async function reserveStock(inventoryItemId: string, qty: number): Promise<void> {
  await prisma.$transaction((tx) => reserveStockTx(tx, inventoryItemId, qty));
}

export async function releaseStock(inventoryItemId: string, qty: number): Promise<void> {
  await prisma.$transaction((tx) => releaseStockTx(tx, inventoryItemId, qty));
}
