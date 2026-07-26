import 'server-only';

import { randomUUID } from 'node:crypto';

import type { Order } from '@prisma/client';

import {
  boundedIds,
  bulkReport,
  type BulkRecord,
  type BulkReport,
} from '../admin/bulk-report';
import type { StaffContext } from '../auth/staff';
import { db } from '../db';
import { cancelUnpaidOrder, ORDER_HOLDS_MONEY, transitionOrder } from './order-service';
import { repeatOrderAtCounter, REPEAT_TILL_BUSY } from './repeat-order';

/**
 * Bulk actions on the order desk at crunch scale (G-024, R-052).
 *
 * Each order is its own attempt, so the batch is a list of individual outcomes
 * rather than one big write that half-succeeded. The reporting rules — bounded,
 * deduplicated, sorted by what the screen shows — are shared with the package
 * board in `admin/bulk-report.ts`.
 */
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
        id,
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
        id,
        label: labelOfOrder(order),
        outcome: 'applied',
        detail: `${order.status} → ${to}`,
      });
      continue;
    }

    const holdsMoney = moved.code === ORDER_HOLDS_MONEY;
    records.push({
      id,
      label: labelOfOrder(order),
      outcome: holdsMoney ? 'skipped' : 'conflict',
      detail: holdsMoney
        ? 'Holds money. Refund it on the order first.'
        : `${order.status}: ${moved.publicMessage}`,
    });
  }

  return bulkReport(batchId, `status:${to}`, records, droppedCount);
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
        id,
        label: labelOfMissing(id),
        outcome: 'skipped',
        detail: 'No longer exists.',
      });
      continue;
    }

    const repeated = await repeatOrderAtCounter(staff, id, seasonId, batchId);
    if (!repeated.ok) {
      records.push({
        id,
        label: labelOfOrder(order),
        outcome: repeated.code === REPEAT_TILL_BUSY ? 'conflict' : 'skipped',
        detail: repeated.publicMessage,
      });
      continue;
    }

    records.push({
      id,
      label: labelOfOrder(order),
      outcome: 'applied',
      detail: `${repeated.value.draftReference}: ${repeated.value.copiedLines} item${
        repeated.value.copiedLines === 1 ? '' : 's'
      }${repeated.value.skippedLines.length > 0 ? `, ${repeated.value.skippedLines.length} not on sale` : ''}`,
    });
  }

  return bulkReport(batchId, 'repeat', records, droppedCount);
}

async function readOrders(ids: string[]): Promise<Map<string, Order>> {
  const rows = await db.order.findMany({ where: { id: { in: ids } } });
  return new Map(rows.map((row) => [row.id, row]));
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
