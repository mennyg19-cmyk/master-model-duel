'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { CustomerAddress } from '@prisma/client';

import { archiveCustomerAddressAction, saveCustomerAddressAction } from '../actions';
import { AddressFields } from '@/components/addresses/address-fields';
import { Button } from '@/components/ui/button';
import { addressSummary } from '@/lib/addresses/address-summary';
import { formatPhone } from '@/lib/core/phone';
import { EMPTY_FORM_STATE } from '@/lib/forms/form-state';

/**
 * The staff view of one customer's address book (UR-014). It writes the same
 * rows the customer's own account page writes; the only difference is the audit
 * row, which names the staff member who made the change (G-019).
 *
 * Removing is one form with a submit button per row rather than a form per row:
 * the button carries the id, so the whole list needs one action and one place to
 * report what happened.
 */
export function AddressBookEditor({
  customerId,
  addresses,
  editing,
}: {
  customerId: string;
  addresses: CustomerAddress[];
  editing: CustomerAddress | null;
}) {
  const [saveState, saveAction, isSaving] = useActionState(
    saveCustomerAddressAction,
    EMPTY_FORM_STATE,
  );
  const [archiveState, archiveAction, isArchiving] = useActionState(
    archiveCustomerAddressAction,
    EMPTY_FORM_STATE,
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Address book</h2>

        {addresses.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">No saved recipients.</p>
        ) : (
          <form action={archiveAction} className="space-y-2" data-testid="staff-address-list">
            <input type="hidden" name="customerId" value={customerId} />

            {addresses.map((address) => (
              <div
                key={address.id}
                className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4 text-sm"
                data-testid="staff-address-row"
                data-address-id={address.id}
              >
                <p className="font-medium">
                  {address.recipientName}
                  {address.label ? ` · ${address.label}` : ''}
                </p>
                <p className="text-[var(--color-ink-muted)]">{addressSummary(address)}</p>
                {address.phone ? (
                  <p className="text-[var(--color-ink-muted)]">{formatPhone(address.phone)}</p>
                ) : null}

                <div className="mt-2 flex items-center gap-4">
                  <Link
                    href={`/admin/customers/${customerId}?edit=${address.id}`}
                    className="text-[var(--color-brand)] underline underline-offset-4"
                    data-testid="staff-address-edit"
                  >
                    Edit
                  </Link>
                  <button
                    type="submit"
                    name="addressId"
                    value={address.id}
                    disabled={isArchiving}
                    className="underline underline-offset-4"
                    data-testid="staff-address-archive"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}

            {archiveState.error ? (
              <p role="alert" className="text-sm text-[var(--color-danger)]">
                {archiveState.error}
              </p>
            ) : null}
            {archiveState.notice ? (
              <p className="text-sm text-[var(--color-success)]">{archiveState.notice}</p>
            ) : null}
          </form>
        )}
      </section>

      <form
        action={saveAction}
        key={editing?.id ?? 'new'}
        className="space-y-4 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-5"
        data-testid="staff-address-form"
      >
        <h2 className="text-lg font-semibold">
          {editing ? `Edit ${editing.recipientName}` : 'Add a recipient'}
        </h2>

        <input type="hidden" name="customerId" value={customerId} />
        {editing ? <input type="hidden" name="addressId" value={editing.id} /> : null}

        <AddressFields
          values={editing ?? undefined}
          knownRecipients={addresses.map((address) => address.recipientName)}
          idPrefix="staff-address"
        />

        {saveState.error ? (
          <p role="alert" className="text-sm text-[var(--color-danger)]" data-testid="staff-address-error">
            {saveState.error}
          </p>
        ) : null}
        {saveState.notice ? (
          <p className="text-sm text-[var(--color-success)]" data-testid="staff-address-notice">
            {saveState.notice}
          </p>
        ) : null}

        <Button type="submit" disabled={isSaving} data-testid="staff-address-submit">
          {isSaving ? 'Saving…' : 'Save address'}
        </Button>
      </form>
    </div>
  );
}
