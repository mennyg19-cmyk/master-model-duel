'use server';

import { revalidatePath } from 'next/cache';

import { archiveCustomerAddress, saveCustomerAddress } from '@/lib/addresses/address-book';
import { addressFieldsFromForm } from '@/lib/addresses/address-form';
import { requirePermission } from '@/lib/auth/staff';
import { trimmedField } from '@/lib/forms/form-data';
import type { FormState } from '@/lib/forms/form-state';

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
