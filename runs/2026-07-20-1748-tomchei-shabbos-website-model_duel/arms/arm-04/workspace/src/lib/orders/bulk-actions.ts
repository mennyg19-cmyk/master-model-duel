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
import type { Result } from '../core/result';
import { db } from '../db';
import { cancelUnpaidOrder, ORDER_HOLDS_MONEY, transitionOrder } from './order-service';
import {
  repeatLatestOrderForCustomer,
  repeatOrderAtCounter,
  REPEAT_TILL_BUSY,
  type RepeatResult,
} from './repeat-order';

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
      records.push(missingRecord(id));
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
      records.push(missingRecord(id));
      continue;
    }

    records.push(
      recordRepeatOutcome(
        id,
        labelOfOrder(order),
        await repeatOrderAtCounter(staff, id, seasonId, batchId),
      ),
    );
  }

  return bulkReport(batchId, 'repeat', records, droppedCount);
}

/**
 * The same sweep starting from people rather than orders (R-058).
 *
 * The office's version of "call last year's list back": tick the customers,
 * and each one's most recent order from an earlier season becomes a draft on
 * the till. A customer who never ordered before is a skip with a reason, not a
 * silent gap in the batch.
 */
export async function bulkRepeatCustomerHistory(
  staff: StaffContext,
  customerIds: string[],
  seasonId: string,
): Promise<BulkReport> {
  const batchId = randomUUID();
  const { ids, droppedCount } = boundedIds(customerIds);
  const customers = new Map(
    (
      await db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })
    ).map((customer) => [customer.id, customer.fullName]),
  );
  const records: BulkRecord[] = [];

  for (const id of ids) {
    const name = customers.get(id);
    if (name === undefined) {
      records.push(missingRecord(id));
      continue;
    }

    records.push(
      recordRepeatOutcome(id, name, await repeatLatestOrderForCustomer(staff, id, seasonId, batchId)),
    );
  }

  return bulkReport(batchId, 'repeat-history', records, droppedCount);
}

/**
 * One row of a repeat sweep, whether the batch started from orders or people.
 * A till already holding a cart for that customer is a conflict somebody can
 * clear; anything else the repeat refused is a skip with its own reason.
 */
function recordRepeatOutcome(id: string, label: string, repeated: Result<RepeatResult>): BulkRecord {
  if (!repeated.ok) {
    return {
      id,
      label,
      outcome: repeated.code === REPEAT_TILL_BUSY ? 'conflict' : 'skipped',
      detail: repeated.publicMessage,
    };
  }

  return { id, label, outcome: 'applied', detail: describeRepeat(repeated.value) };
}

function describeRepeat(repeated: RepeatResult): string {
  const skipped = repeated.skippedLines.length;

  return `${repeated.draftReference}: ${repeated.copiedLines} item${
    repeated.copiedLines === 1 ? '' : 's'
  }${skipped > 0 ? `, ${skipped} not on sale` : ''}`;
}

function missingRecord(id: string): BulkRecord {
  return { id, label: labelOfMissing(id), outcome: 'skipped', detail: 'No longer exists.' };
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
