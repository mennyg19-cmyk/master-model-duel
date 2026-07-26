'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { z } from 'zod';

import { requirePermission } from '@/lib/auth/staff';
import { dollarsFromForm, formatCents } from '@/lib/core/money';
import { trimmedField } from '@/lib/forms/form-data';
import {
  postOfflinePayment,
  refundPayment,
  voidPayment,
} from '@/lib/payments/offline-payments';
import { transitionOrder } from '@/lib/orders/order-service';
import { readStaffOrderMoney } from '@/lib/orders/staff-orders';

/**
 * The money desk's actions (UR-011, R-127).
 *
 * Each one re-checks the permission through `requirePermission` and then hands
 * the work to the payment services, which check it again against the staff
 * context they are given. That is not duplication for its own sake: the route
 * gate decides who may open the page, and the service decides who may move
 * money, and a future POS screen calling the same service inherits the rule.
 */
function orderPath(orderId: string): string {
  return `/admin/orders/${orderId}`;
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
  if (status.data === 'CANCELLED') {
    const money = await readStaffOrderMoney(orderId);
    if (money && money.amountPaidCents > 0) {
      back(
        orderId,
        `This order still holds ${formatCents(money.amountPaidCents)}. Refund or void it before cancelling.`,
      );
    }
  }

  const moved = await transitionOrder(orderId, status.data, staff);
  if (!moved.ok) back(orderId, moved.publicMessage);

  done(orderId, `Order is now ${moved.value.status.toLowerCase()}.`);
}

function done(orderId: string, notice: string): never {
  revalidatePath(orderPath(orderId));
  redirect(`${orderPath(orderId)}?notice=${encodeURIComponent(notice)}`);
}

function back(orderId: string, problem: string): never {
  redirect(`${orderPath(orderId)}?problem=${encodeURIComponent(problem)}`);
}
