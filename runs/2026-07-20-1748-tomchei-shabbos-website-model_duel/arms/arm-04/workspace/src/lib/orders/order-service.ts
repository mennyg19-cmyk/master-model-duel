import 'server-only';

import type { Order, OrderStatus, Package, Prisma, Reservation } from '@prisma/client';

import { recordAudit, type AuditActor } from '../audit';
import { feeSubjectsFrom } from '../checkout/fee-subjects';
import { resolveFulfillmentFees, type RateRules } from '../checkout/fees';
import { formatCents, sumCents } from '../core/money';
import { failure, type Failure, type Result } from '../core/result';
import { db } from '../db';
import { queueOrderConfirmation } from '../email/transactional';
import { abort, runInTransaction } from '../transaction';
import { inventoryDemand, type InventoryDemand } from '../inventory/demand';
import { releaseUnits, reserveUnits, type InventoryTarget } from '../inventory/reserve';
import { readSetting } from '../settings';
import {
  liveRatesFrom,
  quoteShippingBoxes,
  recordQuote,
  type ShipmentQuote,
} from '../shipping/quote-service';
import { ownerFilter, type DraftOwner } from './draft-access';
import { groupLinesIntoPackages } from './grouping';
import { isLineAssigned, lineTotalWithAddOns, type AssignedLine } from './lines';
import { checkOrderTransition } from './state-machine';

export const ORDER_NOT_FOUND = 'order_not_found';
export const SEASON_CLOSED = 'season_closed';
export const EMPTY_ORDER = 'empty_order';
export const UNASSIGNED_LINES = 'unassigned_lines';
export const CONCURRENT_CHANGE = 'concurrent_order_change';
export const ORDER_HOLDS_MONEY = 'order_holds_money';

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
  // Both read before the transaction opens, because both of them talk to
  // something outside this database — the settings table and a carrier — and a
  // transaction that waits on an HTTP call holds the season's number counter
  // while it does. A box whose contents changed in between simply finds no quote
  // under its key and is priced at the settings rate.
  const [rules, shippingQuotes] = await Promise.all([readRateRules(), quoteDraftShipping(orderId)]);

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

    // Cart-first building means a line can sit in the cart with no recipient yet
    // (UR-006), and a package cannot be built from one. This is the gate that
    // keeps that half-finished state inside the builder.
    const lines = order.lines.filter(isLineAssigned);
    if (lines.length !== order.lines.length) {
      const waiting = order.lines.length - lines.length;
      abort(
        failure(
          UNASSIGNED_LINES,
          `${waiting} ${waiting === 1 ? 'item is' : 'items are'} still waiting for a recipient.`,
        ),
      );
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

    await reserveInventoryFor(tx, order.id, lines);

    const orderNumber = await claimOrderNumber(tx, order.seasonId);
    const packages = await createPackages(tx, order.id, lines, actor);
    const totals = await chargeFulfillment(tx, lines, packages, rules, shippingQuotes);

    await tx.order.update({ where: { id: order.id }, data: { orderNumber, ...totals } });

    // Queued inside the same transaction as the order it confirms (R-087): a
    // finalize that rolls back must not leave a customer holding an email for
    // an order that does not exist.
    await queueOrderConfirmation(
      { ...order, orderNumber },
      packages.length,
      totals.totalCents,
      tx,
    );

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
 *
 * `owner` narrows the move to one customer's or one guest's order, so an id that
 * came off a form cannot reach somebody else's even if the caller forgot to look
 * first. Staff moves pass null: `requirePermission` is their gate, and the office
 * is allowed to touch an order that is not theirs.
 */
export type TransitionOptions = {
  owner?: DraftOwner | null;
  /**
   * A last condition on the order as it stands inside the transaction. Anything
   * a caller checked before calling was read off a screen or a batch list; this
   * runs against the row that is about to move.
   */
  guard?: (order: Order) => Failure | null;
  /** Set when this move is one order out of a bulk sweep (G-024). */
  batchId?: string;
};

export async function transitionOrder(
  orderId: string,
  to: OrderStatus,
  actor: AuditActor,
  options: TransitionOptions = {},
): Promise<Result<Order>> {
  return runInTransaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, ...(options.owner ? ownerFilter(options.owner) : {}) },
    });

    if (!order) abort(failure(ORDER_NOT_FOUND, 'That order no longer exists.'));

    const blocked = options.guard?.(order);
    if (blocked) abort(blocked);

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
        detail: { from: order.status, to, batchId: options.batchId },
      },
      tx,
    );

    return tx.order.findUniqueOrThrow({ where: { id: order.id } });
  });
}

/**
 * Cancelling releases the boxes but leaves the money exactly where it is, so an
 * order that has been paid for is refused until somebody refunds or voids it.
 *
 * The balance is read inside the transaction that moves the status rather than
 * before it: a payment taken between the screen being drawn and the button being
 * pressed would otherwise be cancelled out from under the person who took it.
 */
export function cancelUnpaidOrder(
  orderId: string,
  actor: AuditActor,
  batchId?: string,
): Promise<Result<Order>> {
  return transitionOrder(orderId, 'CANCELLED', actor, {
    batchId,
    guard: (order) =>
      order.amountPaidCents > 0
        ? failure(
            ORDER_HOLDS_MONEY,
            `This order still holds ${formatCents(order.amountPaidCents)}. Refund or void it before cancelling.`,
          )
        : null,
  });
}

/**
 * R-046. A draft holds no stock — reservations are claimed at finalize — so
 * discarding one is the DRAFT → DISCARDED move and nothing else. The owner is
 * required here because every caller has one: a customer or a guest throwing
 * away their own cart.
 */
export function discardDraft(
  owner: DraftOwner,
  orderId: string,
  actor: AuditActor,
): Promise<Result<Order>> {
  return transitionOrder(orderId, 'DISCARDED', actor, { owner });
}

const LINE_INVENTORY_INCLUDE = {
  product: { select: { tracksInventory: true } },
  addOns: { include: { addOn: { select: { tracksInventory: true } } } },
} satisfies Prisma.OrderLineInclude;

type LineWithInventory = Prisma.OrderLineGetPayload<{ include: typeof LINE_INVENTORY_INCLUDE }>;
type AssignedInventoryLine = AssignedLine<LineWithInventory>;

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
 * Sorted, because two orders that lock the same rows in opposite order deadlock
 * each other.
 */
function demandInLockOrder(lines: LineWithInventory[]): InventoryDemand[] {
  return [...inventoryDemand(lines).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, want]) => want);
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
  for (const { target, quantity, itemName } of demandInLockOrder(lines)) {
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
  lines: AssignedInventoryLine[],
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

export async function readRateRules(): Promise<RateRules> {
  const [shippingBaseRateCents, freeShippingThresholdCents] = await Promise.all([
    readSetting('shipping.baseRateCents'),
    readSetting('shipping.freeShippingThresholdCents'),
  ]);

  return { shippingBaseRateCents, freeShippingThresholdCents };
}

/**
 * Carrier quotes for the draft's shipping boxes, keyed by grouping key — the one
 * identifier checkout and finalize agree on before any package row exists.
 */
async function quoteDraftShipping(orderId: string): Promise<Map<string, ShipmentQuote>> {
  const lines = await db.orderLine.findMany({ where: { orderId } });

  return quoteShippingBoxes(
    db,
    groupLinesIntoPackages(lines.filter(isLineAssigned)).map((group) => ({
      key: group.groupingKey,
      destination: group.destination,
      lines: group.lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
    })),
  );
}

/**
 * Prices the fulfillment of every package the order just produced and freezes
 * each amount on its package (G-028).
 *
 * The snapshot is the point. Staff moving a box from delivery to shipping in
 * week two is an operations decision; recomputing the fee from the new method
 * would silently owe the customer money or bill them again for a box already
 * paid for.
 *
 * The carrier quote each shipping box was priced from is written down beside it,
 * so the frozen number can always be traced back to the rates that produced it.
 */
async function chargeFulfillment(
  tx: Prisma.TransactionClient,
  lines: AssignedInventoryLine[],
  packages: Package[],
  rules: RateRules,
  shippingQuotes: Map<string, ShipmentQuote>,
) {
  const subtotalCents = sumCents(lines.map(lineTotalWithAddOns));

  const subjects = await feeSubjectsFrom(
    tx,
    packages.map((row) => ({ key: row.id, destination: row })),
  );

  const quotesByPackage = new Map(
    packages
      .map((row) => [row.id, shippingQuotes.get(row.groupingKey)] as const)
      .filter((pair): pair is [string, ShipmentQuote] => pair[1] !== undefined),
  );

  const fees = resolveFulfillmentFees(subjects, rules, subtotalCents, liveRatesFrom(quotesByPackage));

  for (const fee of fees.lines) {
    await tx.package.update({ where: { id: fee.key }, data: { fulfillmentFeeCents: fee.feeCents } });
  }

  for (const row of packages) {
    const quote = quotesByPackage.get(row.id);
    if (!quote) continue;

    await recordQuote(tx, {
      orderId: row.orderId,
      packageId: row.id,
      groupingKey: row.groupingKey,
      quote,
    });
  }

  return {
    subtotalCents,
    fulfillmentFeeCents: fees.totalCents,
    totalCents: subtotalCents + fees.totalCents,
  };
}
