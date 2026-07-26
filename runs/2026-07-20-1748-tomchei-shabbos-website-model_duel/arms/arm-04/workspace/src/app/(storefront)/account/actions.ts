'use server';

import { redirect } from 'next/navigation';

import { requireSignedInCustomer } from './session';
import { archiveCustomerAddress, saveCustomerAddress } from '@/lib/addresses/address-book';
import { addressFieldsFromForm } from '@/lib/addresses/address-form';
import { updateCustomerProfile } from '@/lib/customers';
import { trimmedField } from '@/lib/forms/form-data';
import type { FormState } from '@/lib/forms/form-state';
import { findOwnedOrder, type DraftOwner } from '@/lib/orders/draft-access';
import { discardDraft } from '@/lib/orders/order-service';

export async function saveProfileAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const customer = await requireSignedInCustomer('/account/profile');

  const saved = await updateCustomerProfile(customer, {
    fullName: trimmedField(formData, 'fullName'),
    phone: trimmedField(formData, 'phone'),
  });

  return saved.ok
    ? { error: null, notice: 'Your details are saved.' }
    : { error: saved.publicMessage, notice: null };
}

export async function saveAddressAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const customer = await requireSignedInCustomer('/account/addresses');

  const saved = await saveCustomerAddress({
    customerId: customer.id,
    addressId: trimmedField(formData, 'addressId') || null,
    ...addressFieldsFromForm(formData),
  });

  if (!saved.ok) return { error: saved.publicMessage, notice: null };

  return {
    error: null,
    notice: saved.value.created
      ? `${saved.value.address.recipientName} is in your address book.`
      : `${saved.value.address.recipientName}'s address is updated.`,
  };
}

/**
 * There is one of these per saved address, so it reports through the URL the way
 * the builder's many small forms do rather than through a hook that would have to
 * be mounted once per row.
 */
export async function archiveAddressAction(formData: FormData): Promise<void> {
  const customer = await requireSignedInCustomer('/account/addresses');

  const archived = await archiveCustomerAddress({
    customerId: customer.id,
    addressId: trimmedField(formData, 'addressId'),
  });

  redirect(
    archived.ok
      ? `/account/addresses?notice=${encodeURIComponent(`${archived.value.recipientName} was removed from your address book.`)}`
      : `/account/addresses?problem=${encodeURIComponent(archived.publicMessage)}`,
  );
}

/**
 * R-046. Ownership is resolved from the session before the order id from the form
 * is used for anything, and the same owner goes into the discard itself, so a
 * posted id can only ever reach the customer's own draft — the pre-check is what
 * tells them why, not what keeps them out.
 */
export async function cancelDraftAction(formData: FormData): Promise<void> {
  const customer = await requireSignedInCustomer('/account/orders');
  const owner: DraftOwner = { kind: 'customer', customerId: customer.id };

  const owned = await findOwnedOrder(owner, trimmedField(formData, 'orderId'));
  if (!owned || owned.status !== 'DRAFT') redirect('/account/orders?problem=missing-draft');

  const discarded = await discardDraft(owner, owned.id, null);
  redirect(discarded.ok ? '/account/orders?notice=draft-cancelled' : '/account/orders?problem=draft-busy');
}
