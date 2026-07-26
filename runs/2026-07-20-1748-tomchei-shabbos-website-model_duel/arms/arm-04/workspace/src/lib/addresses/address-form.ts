import { trimmedField } from '../forms/form-data';
import type { AddressInput } from './address-book';

/**
 * The eight fields `AddressFields` renders, read back off whatever posted it.
 *
 * The builder's add-recipient dialog, the in-order address editor, the account
 * address page and the staff screen all render that one component, so they all
 * read it here: a new address column is one edit rather than four, three of
 * which are easy to miss.
 */
export function addressFieldsFromForm(formData: FormData): AddressInput {
  return {
    recipientName: trimmedField(formData, 'recipientName'),
    label: trimmedField(formData, 'label'),
    line1: trimmedField(formData, 'line1'),
    line2: trimmedField(formData, 'line2'),
    city: trimmedField(formData, 'city'),
    state: trimmedField(formData, 'state'),
    postalCode: trimmedField(formData, 'postalCode'),
    phone: trimmedField(formData, 'phone'),
  };
}
