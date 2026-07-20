"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/cn";
import { AddressForm, EMPTY_ADDRESS } from "@/components/builder/address-form";
import type { AddressInput } from "@/lib/addresses/normalize";
import type { Cart, SavedAddress } from "@/components/builder/types";

type Assignment = NonNullable<Cart["lines"][number]["assignment"]>;
type PickerTab = "onOrder" | "addressBook" | "newRecipient";

function addressesDiffer(saved: AddressInput | null, draft: AddressInput): boolean {
  if (!saved) return false;
  return (
    saved.recipient !== draft.recipient ||
    saved.line1 !== draft.line1 ||
    (saved.line2 ?? "") !== (draft.line2 ?? "") ||
    saved.city !== draft.city ||
    saved.state !== draft.state ||
    saved.zip !== draft.zip
  );
}

/**
 * The three-way recipient picker (UR-006, G-018): on this order / address
 * book / new recipient. Also hosts mid-order editing of saved addresses
 * (R-029) so a wrong house number never forces leaving the builder.
 */
export function AssignmentDialog({
  current,
  onOrderRecipient,
  otherOnOrderLineCount,
  addressBook,
  isSignedIn,
  onAssign,
  onEditSavedAddress,
  onClose,
}: {
  current: Assignment | null;
  onOrderRecipient: AddressInput | null;
  /** How many OTHER lines already ship to the shared on-order address. */
  otherOnOrderLineCount: number;
  addressBook: SavedAddress[];
  isSignedIn: boolean;
  onAssign: (assignment: Assignment, newOnOrderRecipient?: AddressInput) => void;
  onEditSavedAddress: (addressId: string, address: AddressInput) => Promise<string | null>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<PickerTab>(current?.type ?? "onOrder");
  const [onOrderDraft, setOnOrderDraft] = useState<AddressInput>(onOrderRecipient ?? EMPTY_ADDRESS);
  const [newRecipient, setNewRecipient] = useState<AddressInput>(
    current?.type === "newRecipient" ? current.address : EMPTY_ADDRESS
  );
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(
    current?.type === "addressBook" ? current.addressId : (addressBook[0]?.id ?? null)
  );
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<AddressInput>(EMPTY_ADDRESS);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const tabs: { id: PickerTab; label: string }[] = [
    { id: "onOrder", label: "On this order" },
    ...(isSignedIn ? [{ id: "addressBook" as const, label: `Address book (${addressBook.length})` }] : []),
    { id: "newRecipient", label: "New recipient" },
  ];

  function isComplete(address: AddressInput): boolean {
    return Boolean(
      address.recipient.trim() &&
        address.line1.trim() &&
        address.city.trim() &&
        address.state.trim().length === 2 &&
        /^\d{5}$/.test(address.zip)
    );
  }

  async function saveEditedAddress() {
    setErrorMessage(null);
    const failure = await onEditSavedAddress(editingAddressId!, editDraft);
    if (failure) {
      setErrorMessage(failure);
      return;
    }
    setEditingAddressId(null);
  }

  return (
    <Modal title="Who is this going to?" onClose={onClose}>
      <div role="tablist" className="mb-4 flex gap-1 rounded-md bg-brand-soft p-1">
        {tabs.map((candidate) => (
          <button
            key={candidate.id}
            role="tab"
            aria-selected={tab === candidate.id}
            onClick={() => setTab(candidate.id)}
            className={cn(
              "flex-1 rounded px-2 py-1.5 text-xs font-medium",
              tab === candidate.id ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"
            )}
          >
            {candidate.label}
          </button>
        ))}
      </div>

      {tab === "onOrder" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Send this item to the address on this order — usually yourself. There is one
            on-order address per order: every item marked &quot;on this order&quot; ships to it.
          </p>
          {/* DECISION-P4-4: onOrderRecipient is a single per-draft address, so
              editing it here re-addresses every already-assigned on-order line.
              Say so before it happens instead of silently flipping them. */}
          {otherOnOrderLineCount > 0 && addressesDiffer(onOrderRecipient, onOrderDraft) && (
            <p className="rounded-md border border-accent bg-brand-soft p-2 text-xs" role="alert">
              {otherOnOrderLineCount} other {otherOnOrderLineCount === 1 ? "item" : "items"} in your
              cart already {otherOnOrderLineCount === 1 ? "ships" : "ship"} to the on-order address —
              changing it here changes it for {otherOnOrderLineCount === 1 ? "that item" : "them"} too.
            </p>
          )}
          <AddressForm value={onOrderDraft} onChange={setOnOrderDraft} />
          <Button
            disabled={!isComplete(onOrderDraft)}
            onClick={() => onAssign({ type: "onOrder" }, onOrderDraft)}
            data-testid="assign-on-order"
          >
            Assign to this address
          </Button>
        </div>
      )}

      {tab === "addressBook" && (
        <div className="flex flex-col gap-2">
          {addressBook.length === 0 && (
            <p className="text-sm text-muted">
              Your address book is empty. New recipients you add are saved here automatically.
            </p>
          )}
          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {addressBook.map((address) => (
              <li key={address.id} className="rounded-md border border-border p-2">
                {editingAddressId === address.id ? (
                  <div className="flex flex-col gap-2">
                    <AddressForm value={editDraft} onChange={setEditDraft} />
                    {errorMessage && <p className="text-xs text-danger">{errorMessage}</p>}
                    <div className="flex gap-2">
                      <Button disabled={!isComplete(editDraft)} onClick={saveEditedAddress}>
                        Save changes
                      </Button>
                      <Button variant="secondary" onClick={() => setEditingAddressId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="saved-address"
                      className="mt-1"
                      checked={selectedAddressId === address.id}
                      onChange={() => setSelectedAddressId(address.id)}
                    />
                    <span className="flex-1">
                      <span className="font-medium">{address.recipient}</span>
                      {address.label && <span className="ml-1 text-xs text-muted">({address.label})</span>}
                      <br />
                      <span className="text-xs text-muted">
                        {address.line1}
                        {address.line2 ? `, ${address.line2}` : ""}, {address.city}, {address.state}{" "}
                        {address.zip}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="text-xs text-brand hover:underline"
                      onClick={() => {
                        setEditingAddressId(address.id);
                        setEditDraft({
                          recipient: address.recipient,
                          label: address.label ?? undefined,
                          line1: address.line1,
                          line2: address.line2 ?? undefined,
                          city: address.city,
                          state: address.state,
                          zip: address.zip,
                        });
                        setErrorMessage(null);
                      }}
                    >
                      Edit
                    </button>
                  </label>
                )}
              </li>
            ))}
          </ul>
          <Button
            disabled={!selectedAddressId}
            onClick={() => onAssign({ type: "addressBook", addressId: selectedAddressId! })}
            data-testid="assign-address-book"
          >
            Assign to selected recipient
          </Button>
        </div>
      )}

      {tab === "newRecipient" && (
        <div className="flex flex-col gap-3">
          {isSignedIn && (
            <p className="text-sm text-muted">New recipients are saved to your address book automatically.</p>
          )}
          <AddressForm
            value={newRecipient}
            onChange={setNewRecipient}
            onPickSavedAddress={(addressId) => onAssign({ type: "addressBook", addressId })}
          />
          <Button
            disabled={!isComplete(newRecipient)}
            onClick={() => onAssign({ type: "newRecipient", address: newRecipient })}
            data-testid="assign-new-recipient"
          >
            Assign to new recipient
          </Button>
        </div>
      )}
    </Modal>
  );
}
