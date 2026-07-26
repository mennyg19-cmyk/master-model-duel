import 'server-only';

import type { Order, OrderStatus, Package, Prisma, Reservation } from '@prisma/client';

import { recordAudit, type AuditActor } from '../audit';
import { sumCents } from '../core/money';
import { failure, type Result } from '../core/result';
import { abort, runInTransaction } from '../transaction';
import { releaseUnits, reserveUnits, type InventoryTarget } from '../inventory/reserve';
import { groupLinesIntoPackages } from './grouping';
import { checkOrderTransition } from './state-machine';

export const ORDER_NOT_FOUND = 'order_not_found';
export const SEASON_CLOSED = 'season_closed';
export const EMPTY_ORDER = 'empty_order';
export const CONCURRENT_CHANGE = 'concurrent_order_change';

export type FinalizedOrder = {
  orderNumber: number;
  packageCount: number;
  totalCents: number;
};

/**
 * Draft → placed (R-045). Everything happens in one transaction: claim the
 * draft, reserve stock, take an order number, and explode the lines into
 * packages. If any step fails the whole thing rolls back, including the order
 * number, which is why the sequence has no gaps.
 *
 * `actor` is required rather than defaulted. Nothing in this module decides who
 * may place an order — the route does, with `requirePermission` for staff or a
 * draft-reference check for a customer — and an argument the caller has to
 * write is the reminder that the decision was made somewhere.
 */
export async function finalizeOrder(
  orderId: string,
  actor: AuditActor,
): Promise<Result<FinalizedOrder>> {
  return runInTransaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        season: { select: { label: true, status: true } },
        lines: { include: LINE_INVENTORY_INCLUDE },
      },
    });

    if (!order) abort(failure(ORDER_NOT_FOUND, 'That order no longer exists.'));

    const transition = checkOrderTransition(order.status, 'PLACED');
    if (!transition.ok) abort(transition);

    if (order.season.status !== 'OPEN') {
      abort(failure(SEASON_CLOSED, `${order.season.label} is closed, so it cannot take new orders.`));
    }

    if (order.lines.length === 0) {
      abort(failure(EMPTY_ORDER, 'An order needs at least one item before it can be placed.'));
    }

    // Claim the draft before anything else. The row lock this takes is what
    // stops a second finalize of the same order from also reaching the number
    // counter, and the re-checked `status` filter is what makes the loser lose.
    await claimOrderStatus(tx, {
      orderId: order.id,
      from: 'DRAFT',
      to: 'PLACED',
      timestamps: { placedAt: new Date() },
      conflictMessage: 'This order was already placed from another device.',
    });

    await reserveInventoryFor(tx, order.id, order.lines);

    const orderNumber = await claimOrderNumber(tx, order.seasonId);
    const packages = await createPackages(tx, order.id, order.lines, actor);
    const totals = await computeOrderTotals(tx, order.lines, packages);

    await tx.order.update({ where: { id: order.id }, data: { orderNumber, ...totals } });

    await recordAudit(
      actor,
      {
        action: 'order.finalized',
        entityType: 'Order',
        entityId: order.id,
        detail: { orderNumber, packageCount: packages.length, totalCents: totals.totalCents },
      },
      tx,
    );

    return { orderNumber, packageCount: packages.length, totalCents: totals.totalCents };
  });
}

/**
 * The only way an order changes status after it is placed (R-044). Cancelling
 * hands reserved stock back; every other move just records itself.
 */
export async function transitionOrder(
  orderId: string,
  to: OrderStatus,
  actor: AuditActor,
): Promise<Result<Order>> {
  return runInTransaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });

    if (!order) abort(failure(ORDER_NOT_FOUND, 'That order no longer exists.'));

    const transition = checkOrderTransition(order.status, to);
    if (!transition.ok) abort(transition);

    await claimOrderStatus(tx, {
      orderId: order.id,
      from: order.status,
      to,
      timestamps: to === 'DISCARDED' ? { discardedAt: new Date() } : {},
      conflictMessage: 'Someone else moved this order while you were working. Reload and try again.',
    });

    if (to === 'CANCELLED') await releaseInventoryFor(tx, order.id);

    await recordAudit(
      actor,
      {
        action: 'order.status_changed',
        entityType: 'Order',
        entityId: order.id,
        detail: { from: order.status, to },
      },
      tx,
    );

    return tx.order.findUniqueOrThrow({ where: { id: order.id } });
  });
}

/**
 * R-046. A draft holds no stock — reservations are claimed at finalize — so
 * discarding one is the DRAFT → DISCARDED move and nothing else.
 */
export function discardDraft(orderId: string, actor: AuditActor): Promise<Result<Order>> {
  return transitionOrder(orderId, 'DISCARDED', actor);
}

const LINE_INVENTORY_INCLUDE = {
  product: { select: { tracksInventory: true } },
  addOns: { include: { addOn: { select: { tracksInventory: true } } } },
} satisfies Prisma.OrderLineInclude;

type LineWithInventory = Prisma.OrderLineGetPayload<{ include: typeof LINE_INVENTORY_INCLUDE }>;

type InventoryDemand = { target: InventoryTarget; quantity: number; itemName: string };

/**
 * Moves an order from one status to the next, or reports the race it lost.
 *
 * The conditional UPDATE is the lock: it matches only while the row still holds
 * the status this caller read, so the second writer changes nothing and finds
 * out by seeing zero rows.
 */
async function claimOrderStatus(
  tx: Prisma.TransactionClient,
  move: {
    orderId: string;
    from: OrderStatus;
    to: OrderStatus;
    timestamps: Prisma.OrderUpdateManyMutationInput;
    conflictMessage: string;
  },
): Promise<void> {
  const moved = await tx.order.updateMany({
    where: { id: move.orderId, status: move.from },
    data: { status: move.to, version: { increment: 1 }, ...move.timestamps },
  });

  if (moved.count === 0) abort(failure(CONCURRENT_CHANGE, move.conflictMessage));
}

/**
 * Every stock-tracked item the order needs, merged by target and sorted.
 *
 * Merging matters because two lines can carry the same product for different
 * recipients. Sorting matters because two orders that lock the same rows in
 * opposite order deadlock each other.
 */
function mergeInventoryDemand(lines: LineWithInventory[]): InventoryDemand[] {
  const demand = new Map<string, InventoryDemand>();

  const want = (key: string, target: InventoryTarget, quantity: number, itemName: string) => {
    const existing = demand.get(key);
    if (existing) existing.quantity += quantity;
    else demand.set(key, { target, quantity, itemName });
  };

  for (const line of lines) {
    if (line.product.tracksInventory) {
      want(`product:${line.productId}`, { productId: line.productId }, line.quantity, line.productNameSnapshot);
    }

    for (const addOn of line.addOns) {
      if (!addOn.addOn.tracksInventory) continue;
      want(`addon:${addOn.addOnId}`, { addOnId: addOn.addOnId }, addOn.quantity, addOn.addOnNameSnapshot);
    }
  }

  return [...demand.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value);
}

/**
 * Takes the stock and records who took it. The `Reservation` row is the
 * snapshot release reads back: `InventoryItem.reserved` is one counter shared by
 * every order, so it cannot answer "how much of this belongs to order X".
 */
async function reserveInventoryFor(
  tx: Prisma.TransactionClient,
  orderId: string,
  lines: LineWithInventory[],
): Promise<void> {
  for (const { target, quantity, itemName } of mergeInventoryDemand(lines)) {
    const reserved = await reserveUnits(tx, target, quantity);
    if (!reserved.ok) abort({ ...reserved, publicMessage: `${itemName}: ${reserved.publicMessage}` });

    await tx.reservation.create({ data: { orderId, ...target, quantity } });
  }
}

/**
 * Hands back exactly what this order took, in the same target order it took it,
 * and marks the reservations spent so a second cancel cannot release twice.
 */
async function releaseInventoryFor(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const held = await tx.reservation.findMany({
    where: { orderId, status: 'HELD' },
    orderBy: [{ productId: 'asc' }, { addOnId: 'asc' }],
  });

  for (const reservation of held) {
    const released = await releaseUnits(tx, reservationTarget(reservation), reservation.quantity);
    if (!released.ok) abort(released);
  }

  await tx.reservation.updateMany({
    where: { id: { in: held.map((reservation) => reservation.id) } },
    data: { status: 'RELEASED', releasedAt: new Date() },
  });
}

function reservationTarget(reservation: Reservation): InventoryTarget {
  if (reservation.productId !== null) return { productId: reservation.productId };
  if (reservation.addOnId !== null) return { addOnId: reservation.addOnId };

  throw new Error(
    `Reservation ${reservation.id} names neither a product nor an add-on; the XOR check constraint should have made that impossible.`,
  );
}

/**
 * R-151. The increment holds a row lock on the season until the transaction
 * commits, so a second finalize waits and then reads the next value instead of
 * handing out the same number twice.
 */
async function claimOrderNumber(tx: Prisma.TransactionClient, seasonId: string): Promise<number> {
  const season = await tx.season.update({
    where: { id: seasonId },
    data: { nextOrderNumber: { increment: 1 } },
    select: { nextOrderNumber: true },
  });

  return season.nextOrderNumber - 1;
}

async function createPackages(
  tx: Prisma.TransactionClient,
  orderId: string,
  lines: LineWithInventory[],
  actor: AuditActor,
): Promise<Package[]> {
  const created: Package[] = [];

  for (const group of groupLinesIntoPackages(lines)) {
    const row = await tx.package.create({
      data: { orderId, groupingKey: group.groupingKey, ...group.destination },
    });

    await tx.orderLine.updateMany({
      where: { id: { in: group.lines.map((line) => line.id) } },
      data: { packageId: row.id },
    });

    await recordAudit(
      actor,
      {
        action: 'package.created',
        entityType: 'Package',
        entityId: row.id,
        detail: { orderId, recipientName: row.recipientName, lineCount: group.lines.length },
      },
      tx,
    );

    created.push(row);
  }

  return created;
}

/**
 * The fulfillment charge is the method's base fee once per package, which is
 * the per-recipient rule. Bulk delivery charges one fee per destination
 * instead (UR-009); that split arrives with delivery scheduling in P5 and will
 * replace this line, not sit beside it.
 */
async function computeOrderTotals(
  tx: Prisma.TransactionClient,
  lines: LineWithInventory[],
  packages: Package[],
) {
  const subtotalCents = sumCents(
    lines.map((line) => line.lineTotalCents + sumCents(line.addOns.map((addOn) => addOn.lineTotalCents))),
  );

  const methods = await tx.fulfillmentMethod.findMany({
    where: { id: { in: [...new Set(packages.map((row) => row.fulfillmentMethodId))] } },
    select: { id: true, baseFeeCents: true },
  });

  const feeByMethod = new Map(methods.map((method) => [method.id, method.baseFeeCents]));
  const fulfillmentFeeCents = sumCents(packages.map((row) => baseFee(feeByMethod, row)));

  return { subtotalCents, fulfillmentFeeCents, totalCents: subtotalCents + fulfillmentFeeCents };
}

function baseFee(feeByMethod: Map<string, number>, row: Package): number {
  const fee = feeByMethod.get(row.fulfillmentMethodId);

  // The FK is RESTRICT, so a missing row means the method was read outside this
  // transaction, not that a package may be charged nothing.
  if (fee === undefined) {
    throw new Error(
      `Package ${row.id} points at fulfillment method ${row.fulfillmentMethodId}, which was not read with the others.`,
    );
  }

  return fee;
}
