'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { recordAudit } from '@/lib/audit';
import { requirePermission, type StaffContext } from '@/lib/auth/staff';
import { dollarsFromForm } from '@/lib/core/money';
import { failure, ok, type Result } from '@/lib/core/result';
import { redirectWithFlash } from '@/lib/forms/flash-redirect';
import { trimmedField } from '@/lib/forms/form-data';
import {
  postOfflinePayment,
  refundPayment,
  voidPayment,
} from '@/lib/payments/offline-payments';
import {
  bulkChangeStatus,
  bulkRepeat,
  isBulkStatusAction,
  summarizeBulk,
  type BulkReport,
} from '@/lib/orders/bulk-actions';
import { cancelUnpaidOrder, transitionOrder } from '@/lib/orders/order-service';
import { repeatOrderAtCounter } from '@/lib/orders/repeat-order';
import { openSeasonForCounter } from '@/lib/pos/counter';
import { posBuilderPath } from '@/lib/pos/paths';

/**
 * The money desk's actions (UR-011, R-127).
 *
 * Each one re-checks the permission through `requirePermission` and then hands
 * the work to the payment services, which check it again against the staff
 * context they are given. That is not duplication for its own sake: the route
 * gate decides who may open the page, and the service decides who may move
 * money, and a future POS screen calling the same service inherits the rule.
 */
const DESK_PATH = '/admin/orders';

function orderPath(orderId: string): string {
  return `${DESK_PATH}/${orderId}`;
}

export async function postOfflinePaymentAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('orders.manage');
  const orderId = trimmedField(formData, 'orderId');

  const amount = dollarsFromForm.safeParse(trimmedField(formData, 'amount'));
  if (!amount.success) back(orderId, amount.error.issues[0].message);

  const method = trimmedField(formData, 'method');
  if (method !== 'CASH' && method !== 'CHECK') back(orderId, 'Choose cash or check.');

  const posted = await postOfflinePayment(staff, {
    orderId,
    method,
    amountCents: amount.data,
    reference: trimmedField(formData, 'reference'),
  });

  if (!posted.ok) back(orderId, posted.publicMessage);
  done(orderId, `Recorded ${method === 'CASH' ? 'cash' : 'check'} payment.`);
}

export async function voidPaymentAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('orders.manage');
  const orderId = trimmedField(formData, 'orderId');

  const voided = await voidPayment(staff, {
    paymentId: trimmedField(formData, 'paymentId'),
    reason: trimmedField(formData, 'reason'),
  });

  if (!voided.ok) back(orderId, voided.publicMessage);
  done(orderId, 'Payment voided.');
}

export async function refundPaymentAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('orders.manage');
  const orderId = trimmedField(formData, 'orderId');

  const amount = dollarsFromForm.safeParse(trimmedField(formData, 'amount'));
  if (!amount.success) back(orderId, amount.error.issues[0].message);

  const refunded = await refundPayment(staff, {
    paymentId: trimmedField(formData, 'paymentId'),
    amountCents: amount.data,
    reason: trimmedField(formData, 'reason'),
  });

  if (!refunded.ok) back(orderId, refunded.publicMessage);
  done(orderId, 'Refund recorded.');
}

/**
 * Cancelling hands the reserved stock back, which is why it lives with the
 * money. The target is read against a fixed list rather than cast: the state
 * machine would refuse an impossible move anyway, but a form field should not
 * be able to name a status that does not exist.
 */
const staffTransitionSchema = z.enum(['IN_FULFILLMENT', 'COMPLETED', 'CANCELLED']);

export async function changeOrderStatusAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('orders.manage');
  const orderId = trimmedField(formData, 'orderId');

  const status = staffTransitionSchema.safeParse(trimmedField(formData, 'status'));
  if (!status.success) back(orderId, 'That is not a status an order can be moved to.');

  // Cancelling releases the stock but leaves the money where it is, so a paid
  // order cancelled here would owe a refund nobody is looking at. The money goes
  // back first, on this same screen, and then the order can close.
  const moved =
    status.data === 'CANCELLED'
      ? await cancelUnpaidOrder(orderId, staff)
      : await transitionOrder(orderId, status.data, staff);
  if (!moved.ok) back(orderId, moved.publicMessage);

  done(orderId, `Order is now ${moved.value.status.toLowerCase()}.`);
}

/**
 * "Same again" for one order (R-057). It lands on the counter as an open cart
 * rather than a placed order: this season's prices are not last season's, and
 * whoever is paying should see the new total first.
 */
export async function repeatOrderAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('orders.manage');
  const orderId = trimmedField(formData, 'orderId');

  const season = await openSeasonForCounter();
  if (!season.ok) back(orderId, season.publicMessage);

  const repeated = await repeatOrderAtCounter(staff, orderId, season.value.id);
  if (!repeated.ok) back(orderId, repeated.publicMessage);

  const skipped = repeated.value.skippedLines;
  redirectWithFlash(posBuilderPath(repeated.value.customerId), {
    notice:
      skipped.length === 0
        ? `Copied ${repeated.value.copiedLines} line${repeated.value.copiedLines === 1 ? '' : 's'} into a new cart.`
        : `Copied ${repeated.value.copiedLines}. Not on sale this season: ${skipped.join(', ')}.`,
  });
}

/**
 * One click, many orders (G-024).
 *
 * The report is kept rather than summarized away: "38 updated, 4 skipped, 2
 * conflicted" goes on the URL, and the batch itself is written to the audit
 * trail so the detail survives the redirect. What the screen must never say is
 * a bare "done" over a batch where a colleague had already moved six of them.
 */
export async function bulkAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('orders.manage');
  const returnTo = trimmedField(formData, 'returnTo');
  const orderIds = formData.getAll('orderIds').map(String);

  if (orderIds.length === 0) backToDesk(returnTo, 'Tick the orders you want to act on first.');

  const action = trimmedField(formData, 'action');
  const swept = await runBulk(staff, action, orderIds);
  if (!swept.ok) backToDesk(returnTo, swept.publicMessage);

  const report = swept.value;

  // The summary is a convenience, not the record. Each order was moved in its
  // own transaction, so there is nothing for this write to be atomic with: if it
  // fails, the sweep is still reconstructible from the per-order rows that carry
  // the same batchId.
  await recordAudit(staff, {
    action: 'orders.bulk_action',
    entityType: 'Order',
    entityId: report.batchId,
    detail: {
      batchId: report.batchId,
      action: report.action,
      applied: report.applied,
      skipped: report.skipped,
      conflicts: report.conflicts,
      droppedCount: report.droppedCount,
    },
  });

  revalidatePath(DESK_PATH);
  doneAtDesk(returnTo, `${summarizeBulk(report)} — ${firstFewOutcomes(report)}`);
}

const UNKNOWN_BULK_ACTION = 'unknown_bulk_action';

/**
 * A batch that cannot run and a batch the list has never heard of are two
 * different things to the person who pressed the button: one means "open a
 * season first" and the other means the form was tampered with. They used to
 * share a `null` return, so a closed season was reported as a typo.
 */
async function runBulk(
  staff: StaffContext,
  action: string,
  orderIds: string[],
): Promise<Result<BulkReport>> {
  if (isBulkStatusAction(action)) return ok(await bulkChangeStatus(staff, orderIds, action));
  if (action !== 'REPEAT') {
    return failure(UNKNOWN_BULK_ACTION, 'That is not something this list can do.');
  }

  const season = await openSeasonForCounter();
  if (!season.ok) return season;

  return ok(await bulkRepeat(staff, orderIds, season.value.id));
}

/** Enough of the report to act on without opening the audit log. */
const OUTCOMES_IN_NOTICE = 4;

function firstFewOutcomes(report: BulkReport): string {
  const notable = report.records.filter((record) => record.outcome !== 'applied');
  const shown = (notable.length > 0 ? notable : report.records).slice(0, OUTCOMES_IN_NOTICE);
  const rest = (notable.length > 0 ? notable.length : report.records.length) - shown.length;

  return [
    ...shown.map((record) => `${record.label} ${record.outcome}: ${record.detail}`),
    ...(rest > 0 ? [`and ${rest} more`] : []),
  ].join('; ');
}

/** The desk's own filters. Anything else a form posted back is not a filter. */
const DESK_FILTERS = ['q', 'status', 'payment', 'size', 'page'] as const;

/**
 * `returnTo` is a hidden field, which means it is whatever the browser sent. It
 * used to be pasted into the redirect as text, so an `&` or a `#` in it could
 * append a parameter of the caller's choosing or cut the flash message off the
 * end. The filters are read out of it by name and the URL is built here.
 */
function deskFilters(returnTo: string): Record<string, string> {
  const posted = new URLSearchParams(returnTo);
  const kept: Record<string, string> = {};

  for (const name of DESK_FILTERS) {
    const value = posted.get(name);
    if (value) kept[name] = value;
  }

  return kept;
}

function doneAtDesk(returnTo: string, notice: string): never {
  redirectWithFlash(DESK_PATH, { ...deskFilters(returnTo), notice });
}

function backToDesk(returnTo: string, problem: string): never {
  redirectWithFlash(DESK_PATH, { ...deskFilters(returnTo), problem });
}

function done(orderId: string, notice: string): never {
  revalidatePath(orderPath(orderId));
  redirectWithFlash(orderPath(orderId), { notice });
}

function back(orderId: string, problem: string): never {
  redirectWithFlash(orderPath(orderId), { problem });
}
