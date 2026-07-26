'use client';

import { useActionState } from 'react';

import { saveAddressAction } from '../actions';
import { AddressFields, type AddressFieldValues } from '@/components/addresses/address-fields';
import { Button } from '@/components/ui/button';
import { EMPTY_FORM_STATE } from '@/lib/forms/form-state';

/**
 * One form for both jobs. Editing is the same fields with an id in a hidden
 * input, which is what keeps the validation and the dedupe identical whether an
 * address is being added or corrected (R-025).
 */
export function AddressBookForm({
  editing,
  knownRecipients,
}: {
  editing: (AddressFieldValues & { id: string }) | null;
  knownRecipients: string[];
}) {
  const [state, formAction, isPending] = useActionState(saveAddressAction, EMPTY_FORM_STATE);

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-5"
      data-testid="address-form"
      key={editing?.id ?? 'new'}
    >
      <h2 className="text-lg font-semibold">
        {editing ? `Edit ${editing.recipientName}` : 'Add a recipient'}
      </h2>

      {editing ? <input type="hidden" name="addressId" value={editing.id} /> : null}

      <AddressFields
        values={editing ?? undefined}
        knownRecipients={knownRecipients}
        idPrefix="account-address"
      />

      {state.error ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]" data-testid="address-error">
          {state.error}
        </p>
      ) : null}

      {state.notice ? (
        <p className="text-sm text-[var(--color-success)]" data-testid="address-notice">
          {state.notice}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending} data-testid="address-submit">
        {isPending ? 'Saving…' : 'Save address'}
      </Button>
    </form>
  );
}
