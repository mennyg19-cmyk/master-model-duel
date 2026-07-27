'use server';

import { revalidatePath } from 'next/cache';

import { addressFieldsFromForm } from '@/lib/addresses/address-form';
import { archiveCustomerAddress, saveCustomerAddress } from '@/lib/addresses/address-book';
import { firstFewOutcomes, summarizeBulk } from '@/lib/admin/bulk-report';
import { recordAudit } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/staff';
import { redirectWithFlash } from '@/lib/forms/flash-redirect';
import { trimmedField } from '@/lib/forms/form-data';
import type { FormState } from '@/lib/forms/form-state';
import { bulkRepeatCustomerHistory } from '@/lib/orders/bulk-actions';
import { openSeasonForCounter } from '@/lib/pos/counter';

/**
 * UR-014, G-019. Staff share the customer's own address book rather than keeping
 * a second copy, and the audit row carries the staff member's name — the whole
 * point of letting the office edit somebody else's records.
 */
export async function saveCustomerAddressAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const context = await requirePermission('customers.manage');
  const customerId = trimmedField(formData, 'customerId');

  const saved = await saveCustomerAddress(
    { customerId, addressId: trimmedField(formData, 'addressId') || null, ...addressFieldsFromForm(formData) },
    context,
  );

  if (!saved.ok) return { error: saved.publicMessage, notice: null };

  revalidatePath(`/admin/customers/${customerId}`);
  return { error: null, notice: `Saved ${saved.value.address.recipientName}.` };
}

export async function archiveCustomerAddressAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const context = await requirePermission('customers.manage');
  const customerId = trimmedField(formData, 'customerId');

  const archived = await archiveCustomerAddress(
    { customerId, addressId: trimmedField(formData, 'addressId') },
    context,
  );

  if (!archived.ok) return { error: archived.publicMessage, notice: null };

  revalidatePath(`/admin/customers/${customerId}`);
  return { error: null, notice: `Removed ${archived.value.recipientName}.` };
}

const DIRECTORY_PATH = '/admin/customers';

/**
 * "Call last year's list back" (R-058, G-024).
 *
 * Selling is a different permission from reading the directory, so this asks
 * for `orders.manage` rather than the `customers.view` the page itself needs.
 * Every customer is repeated in their own transaction and the batch reports
 * per person, because half of a hundred-row sweep succeeding is the normal
 * outcome the week before Purim.
 */
export async function bulkRepeatHistoryAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('orders.manage');
  const query = trimmedField(formData, 'q');
  const customerIds = formData.getAll('customerIds').map(String);

  if (customerIds.length === 0) {
    redirectWithFlash(DIRECTORY_PATH, { q: query, problem: 'Tick the customers you want to call back first.' });
  }

  const season = await openSeasonForCounter();
  if (!season.ok) redirectWithFlash(DIRECTORY_PATH, { q: query, problem: season.publicMessage });

  const report = await bulkRepeatCustomerHistory(staff, customerIds, season.value.id);

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

  revalidatePath(DIRECTORY_PATH);
  redirectWithFlash(DIRECTORY_PATH, {
    q: query,
    notice: `${summarizeBulk(report)} — ${firstFewOutcomes(report)}`,
  });
}
