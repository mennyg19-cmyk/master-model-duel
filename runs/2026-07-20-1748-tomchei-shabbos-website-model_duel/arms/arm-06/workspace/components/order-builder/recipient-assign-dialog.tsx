"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { BookAddress, RecipientState } from "./types";
import { recipientFromBook } from "./recipients";
import { AddRecipientDialog } from "./add-recipient-dialog";

// R-027/R-028 + UR-006/G-018: the three-way recipient picker. One line gets
// assigned to (1) a recipient already on this order, (2) a saved address-book
// entry, or (3) a brand-new recipient (auto-saves to the book).
export function RecipientAssignDialog({
  lineLabel,
  currentRecipientId,
  recipients,
  bookAddresses,
  isCustomer,
  onAssign,
  onRecipientCreated,
  onEditAddress,
  onClose,
}: {
  lineLabel: string;
  currentRecipientId: string | null;
  recipients: RecipientState[];
  bookAddresses: BookAddress[];
  isCustomer: boolean;
  onAssign: (recipientClientId: string) => void;
  onRecipientCreated: (recipient: RecipientState) => void;
  onEditAddress: (address: BookAddress) => void;
  onClose: () => void;
}) {
  const [addingNew, setAddingNew] = useState(false);

  if (addingNew) {
    return (
      <AddRecipientDialog
        bookAddresses={bookAddresses}
        isCustomer={isCustomer}
        onCreated={(recipient) => {
          onRecipientCreated(recipient);
          onAssign(recipient.clientId);
          onClose();
        }}
        onClose={() => setAddingNew(false)}
      />
    );
  }

  return (
    <Dialog label={`Assign ${lineLabel} to a recipient`} onClose={onClose} panelClassName="max-w-lg">
      <h2 className="text-lg font-semibold text-stone-900">Who gets {lineLabel}?</h2>

      <div className="mt-4 flex flex-col gap-5">
        <section>
          <h3 className="text-xs font-medium uppercase tracking-wide text-stone-500">On this order</h3>
          {recipients.length === 0 ? (
            <p className="mt-1.5 text-sm text-stone-500">No recipients yet — add one below.</p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {recipients.map((recipient) => (
                <li key={recipient.clientId}>
                  <button
                    type="button"
                    onClick={() => {
                      onAssign(recipient.clientId);
                      onClose();
                    }}
                    aria-pressed={currentRecipientId === recipient.clientId}
                    className={
                      currentRecipientId === recipient.clientId
                        ? "w-full rounded-md border border-brand-700 bg-brand-50 px-3 py-2 text-left text-sm text-brand-900"
                        : "w-full rounded-md border border-stone-200 px-3 py-2 text-left text-sm text-stone-700 hover:bg-stone-50"
                    }
                    data-assign-on-order
                  >
                    <span className="font-medium">{recipient.name}</span>
                    <span className="text-stone-500"> · {recipient.line1}, {recipient.city}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {isCustomer && (
          <section>
            <h3 className="text-xs font-medium uppercase tracking-wide text-stone-500">Address book</h3>
            {bookAddresses.length === 0 ? (
              <p className="mt-1.5 text-sm text-stone-500">No saved addresses yet.</p>
            ) : (
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {bookAddresses.map((address) => (
                  <li key={address.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        // A book address already on this order is reused, not
                        // duplicated — one recipient per book row per cart.
                        const existing = recipients.find((recipient) => recipient.addressId === address.id);
                        const recipient = existing ?? recipientFromBook(address);
                        if (!existing) onRecipientCreated(recipient);
                        onAssign(recipient.clientId);
                        onClose();
                      }}
                      className="flex-1 rounded-md border border-stone-200 px-3 py-2 text-left text-sm text-stone-700 hover:bg-stone-50"
                      data-assign-book
                    >
                      <span className="font-medium">{address.label ?? address.line1}</span>
                      <span className="text-stone-500"> · {address.summary}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onEditAddress(address)}
                      className="text-xs text-brand-700 hover:underline"
                      aria-label={`Edit saved address ${address.label ?? address.line1}`}
                    >
                      Edit
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section>
          <h3 className="text-xs font-medium uppercase tracking-wide text-stone-500">New recipient</h3>
          <Button variant="secondary" className="mt-1.5" onClick={() => setAddingNew(true)} data-assign-new>
            Add a new recipient{isCustomer ? " (saved to your address book)" : ""}
          </Button>
        </section>
      </div>

      <div className="mt-5 flex justify-end">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}
