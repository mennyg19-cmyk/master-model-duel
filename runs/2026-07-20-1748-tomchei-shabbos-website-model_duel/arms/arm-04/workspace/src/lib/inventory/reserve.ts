import 'server-only';

import { Prisma } from '@prisma/client';

import type { DbClient } from '../core/db-client';
import { failure, ok, type Result } from '../core/result';

export const INSUFFICIENT_INVENTORY = 'insufficient_inventory';
export const INVENTORY_NOT_CONFIGURED = 'inventory_not_configured';

/** A row counts a product or an add-on, never both (R-158). */
export type InventoryTarget = { productId: string } | { addOnId: string };

/**
 * Claims stock for an order.
 *
 * The whole decision is one UPDATE: Postgres takes a row lock, and the
 * `onHand - reserved >= quantity` test is re-evaluated against the committed
 * row, so two checkouts racing for the last unit cannot both pass. Reading the
 * count first and writing second would let both read "1 left".
 */
export async function reserveUnits(
  client: DbClient,
  target: InventoryTarget,
  quantity: number,
): Promise<Result<null>> {
  assertPositive(quantity, 'reserve');

  const rowsChanged = await client.$executeRaw`
    UPDATE "InventoryItem"
    SET "reserved" = "reserved" + ${quantity}, "updatedAt" = NOW()
    WHERE ${targetFilter(target)} AND "onHand" - "reserved" >= ${quantity}`;

  if (rowsChanged === 1) return ok(null);
  return explainMiss(client, target, quantity);
}

/** Gives stock back when a draft is discarded or a placed order is cancelled. */
export async function releaseUnits(
  client: DbClient,
  target: InventoryTarget,
  quantity: number,
): Promise<Result<null>> {
  assertPositive(quantity, 'release');

  const rowsChanged = await client.$executeRaw`
    UPDATE "InventoryItem"
    SET "reserved" = "reserved" - ${quantity}, "updatedAt" = NOW()
    WHERE ${targetFilter(target)} AND "reserved" >= ${quantity}`;

  if (rowsChanged === 1) return ok(null);

  return failure(
    INSUFFICIENT_INVENTORY,
    `Cannot release ${quantity} units that were never reserved.`,
  );
}

export async function availableUnits(client: DbClient, target: InventoryTarget): Promise<number | null> {
  const inventory = await client.inventoryItem.findFirst({
    where: target,
    select: { onHand: true, reserved: true },
  });

  return inventory ? inventory.onHand - inventory.reserved : null;
}

/**
 * Only runs when the reservation failed, so the extra read costs nothing on the
 * happy path. "Sold out" and "nobody set this item up" need different answers:
 * one is normal, the other is a catalog mistake.
 */
async function explainMiss(
  client: DbClient,
  target: InventoryTarget,
  quantity: number,
): Promise<Result<null>> {
  const available = await availableUnits(client, target);

  if (available === null) {
    return failure(
      INVENTORY_NOT_CONFIGURED,
      'This item is marked as stock-tracked but has no inventory record yet, so it cannot be sold.',
    );
  }

  return failure(
    INSUFFICIENT_INVENTORY,
    `Only ${available} left in stock and ${quantity} were requested.`,
  );
}

function targetFilter(target: InventoryTarget): Prisma.Sql {
  return 'productId' in target
    ? Prisma.sql`"productId" = ${target.productId}`
    : Prisma.sql`"addOnId" = ${target.addOnId}`;
}

function assertPositive(quantity: number, action: string) {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`Cannot ${action} ${quantity} units; expected a positive whole number.`);
  }
}
