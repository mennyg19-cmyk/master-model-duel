import 'server-only';

import { randomUUID } from 'node:crypto';

import type { Order } from '@prisma/client';

import type { StaffContext } from '../auth/staff';
import { db } from '../db';
import { cancelUnpaidOrder, ORDER_HOLDS_MONEY, transitionOrder } from './order-service';
import { repeatOrderAtCounter, REPEAT_TILL_BUSY } from './repeat-order';

/**
 * Bulk actions at crunch scale (G-024, R-052).
 *
 * The rule this module exists for: a bulk action never reports success it did
 * not have. Two members of staff sweeping the same list on Purim morning is the
 * normal case, not the edge case, and the second one has to be told exactly
 * which orders somebody else already moved rather than being shown "42 orders
 * updated" over a list where eleven of them did nothing.
 *
 * So each order is its own attempt, the batch is bounded, and the report is
 * ordered by order number — the same batch run twice reads the same way, which
 * is what makes it something a manager can compare against a colleague's screen.
 *
 * Every attempt carries the same `batchId` into its own audit row, whatever the
 * action was. That is what lets "show me everything this sweep touched" be one
 * query instead of one query per kind of thing a sweep can do.
 */
export const MAX_BULK_ORDERS = 100;

export type BulkOutcome = 'applied' | 'skipped' | 'conflict';

export type BulkRecord = {
  orderId: string;
  label: string;
  outcome: BulkOutcome;
  detail: string;
};

export type BulkReport = {
  /** On every audit row this sweep wrote, per-order ones included. */
  batchId: string;
  action: string;
  requested: number;
  applied: number;
  skipped: number;
  conflicts: number;
  records: BulkRecord[];
  /** Ids past `MAX_BULK_ORDERS` that were not attempted at all. */
  droppedCount: number;
};

export const BULK_STATUS_ACTIONS = ['IN_FULFILLMENT', 'COMPLETED', 'CANCELLED'] as const;
export type BulkStatusAction = (typeof BULK_STATUS_ACTIONS)[number];

export function isBulkStatusAction(value: string): value is BulkStatusAction {
  return (BULK_STATUS_ACTIONS as readonly string[]).includes(value);
}

/**
 * Moves a selection of orders to one status.
 *
 * Cancelling is the one move that touches money and stock, so an order that has
 * been paid for is skipped rather than cancelled: releasing its boxes without
 * refunding would leave the money on an order nobody is looking at any more.
 * That balance is re-read inside each order's own transaction, not taken from
 * the batch read above — a colleague taking a payment mid-sweep is the case.
 */
export async function bulkChangeStatus(
  staff: StaffContext,
  orderIds: string[],
  to: BulkStatusAction,
): Promise<BulkReport> {
  const batchId = randomUUID();
  const { ids, droppedCount } = boundedIds(orderIds);
  const orders = await readOrders(ids);
  const records: BulkRecord[] = [];

  for (const id of ids) {
    const order = orders.get(id);
    if (!order) {
      records.push({
        orderId: id,
        label: labelOfMissing(id),
        outcome: 'skipped',
        detail: 'No longer exists.',
      });
      continue;
    }

    const moved =
      to === 'CANCELLED'
        ? await cancelUnpaidOrder(id, staff, batchId)
        : await transitionOrder(id, to, staff, { batchId });

    if (moved.ok) {
      records.push({
        orderId: id,
        label: labelOfOrder(order),
        outcome: 'applied',
        detail: `${order.status} → ${to}`,
      });
      continue;
    }

    const holdsMoney = moved.code === ORDER_HOLDS_MONEY;
    records.push({
      orderId: id,
      label: labelOfOrder(order),
      outcome: holdsMoney ? 'skipped' : 'conflict',
      detail: holdsMoney
        ? 'Holds money. Refund it on the order first.'
        : `${order.status}: ${moved.publicMessage}`,
    });
  }

  return report(batchId, `status:${to}`, records, droppedCount);
}

/**
 * Starts a repeat draft for each of a selection of past orders (R-057 shell).
 *
 * Nothing is placed and nothing is charged: the batch leaves one cart per
 * customer on the till for staff to price up and confirm, which is what makes it
 * safe to run over a hundred rows.
 */
export async function bulkRepeat(
  staff: StaffContext,
  orderIds: string[],
  seasonId: string,
): Promise<BulkReport> {
  const batchId = randomUUID();
  const { ids, droppedCount } = boundedIds(orderIds);
  const orders = await readOrders(ids);
  const records: BulkRecord[] = [];

  for (const id of ids) {
    const order = orders.get(id);
    if (!order) {
      records.push({
        orderId: id,
        label: labelOfMissing(id),
        outcome: 'skipped',
        detail: 'No longer exists.',
      });
      continue;
    }

    const repeated = await repeatOrderAtCounter(staff, id, seasonId, batchId);
    if (!repeated.ok) {
      records.push({
        orderId: id,
        label: labelOfOrder(order),
        outcome: repeated.code === REPEAT_TILL_BUSY ? 'conflict' : 'skipped',
        detail: repeated.publicMessage,
      });
      continue;
    }

    records.push({
      orderId: id,
      label: labelOfOrder(order),
      outcome: 'applied',
      detail: `${repeated.value.draftReference}: ${repeated.value.copiedLines} item${
        repeated.value.copiedLines === 1 ? '' : 's'
      }${repeated.value.skippedLines.length > 0 ? `, ${repeated.value.skippedLines.length} not on sale` : ''}`,
    });
  }

  return report(batchId, 'repeat', records, droppedCount);
}

/**
 * De-duplicated and capped before anything is read, so a form posting the whole
 * table cannot turn one click into a thousand transactions.
 */
function boundedIds(orderIds: string[]): { ids: string[]; droppedCount: number } {
  const unique = [...new Set(orderIds.filter((id) => id.trim() !== ''))];
  return { ids: unique.slice(0, MAX_BULK_ORDERS), droppedCount: Math.max(unique.length - MAX_BULK_ORDERS, 0) };
}

async function readOrders(ids: string[]): Promise<Map<string, Order>> {
  const rows = await db.order.findMany({ where: { id: { in: ids } } });
  return new Map(rows.map((row) => [row.id, row]));
}

function report(
  batchId: string,
  action: string,
  records: BulkRecord[],
  droppedCount: number,
): BulkReport {
  // Sorted by what staff read off the screen, not by the order the ids happened
  // to arrive in: two people running the same batch compare line by line.
  const sorted = [...records].sort((left, right) => left.label.localeCompare(right.label));

  return {
    batchId,
    action,
    requested: records.length + droppedCount,
    applied: countOf(records, 'applied'),
    skipped: countOf(records, 'skipped'),
    conflicts: countOf(records, 'conflict'),
    records: sorted,
    droppedCount,
  };
}

function countOf(records: BulkRecord[], outcome: BulkOutcome): number {
  return records.filter((record) => record.outcome === outcome).length;
}

function labelOfOrder(order: Order): string {
  return order.orderNumber === null
    ? order.draftReference
    : `#${String(order.orderNumber).padStart(6, '0')}`;
}

/** An id the batch could not read back: there is no number to show, so show the id. */
function labelOfMissing(id: string): string {
  return `~${id.slice(0, 8)}`;
}

/** The one-line summary a redirect can carry back to the list. */
export function summarizeBulk(report: BulkReport): string {
  const parts = [`${report.applied} updated`];
  if (report.skipped > 0) parts.push(`${report.skipped} skipped`);
  if (report.conflicts > 0) parts.push(`${report.conflicts} conflicted`);
  if (report.droppedCount > 0) parts.push(`${report.droppedCount} over the ${MAX_BULK_ORDERS} limit`);

  return parts.join(', ');
}
