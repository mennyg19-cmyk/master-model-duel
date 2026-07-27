"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AddressForm, EMPTY_ADDRESS } from "@/components/builder/address-form";
import type { AddressInput } from "@/lib/addresses/normalize";
import type { SavedAddress } from "@/components/builder/types";

/** Saved-address account view (R-043): list, add, edit, remove. */
export function AddressesManager({ addresses }: { addresses: SavedAddress[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<AddressInput>(EMPTY_ADDRESS);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function startEdit(address: SavedAddress | null) {
    setErrorMessage(null);
    if (!address) {
      setEditingId("new");
      setDraft(EMPTY_ADDRESS);
      return;
    }
    setEditingId(address.id);
    setDraft({
      recipient: address.recipient,
      label: address.label ?? undefined,
      line1: address.line1,
      line2: address.line2 ?? undefined,
      city: address.city,
      state: address.state,
      zip: address.zip,
    });
  }

  async function save() {
    setIsSubmitting(true);
    setErrorMessage(null);
    const isNew = editingId === "new";
    const response = await fetch(isNew ? "/api/account/addresses" : `/api/account/addresses/${editingId}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    setIsSubmitting(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setErrorMessage(body?.error ?? "Could not save the address");
      return;
    }
    setEditingId(null);
    router.refresh();
  }

  async function remove(addressId: string) {
    if (!confirm("Remove this recipient from your address book?")) return;
    await fetch(`/api/account/addresses/${addressId}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {addresses.length === 0 && editingId !== "new" && (
        <p className="text-sm text-muted">
          No saved recipients yet. Recipients you add while ordering are saved here automatically.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {addresses.map((address) => (
          <li key={address.id} className="rounded-lg border border-border bg-surface p-4 shadow-sm" data-testid="address-row">
            {editingId === address.id ? (
              <div className="flex flex-col gap-2">
                <AddressForm value={draft} onChange={setDraft} />
                {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}
                <div className="flex gap-2">
                  <Button onClick={save} disabled={isSubmitting}>
                    {isSubmitting ? "Saving…" : "Save"}
                  </Button>
                  <Button variant="secondary" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <p className="font-semibold">
                    {address.recipient}
                    {address.label && <span className="ml-1 font-normal text-muted">({address.label})</span>}
                  </p>
                  <p className="text-muted">
                    {address.line1}
                    {address.line2 ? `, ${address.line2}` : ""}, {address.city}, {address.state} {address.zip}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="text-brand hover:underline" onClick={() => startEdit(address)}>
                    Edit
                  </button>
                  <button type="button" className="text-muted hover:text-danger" onClick={() => remove(address.id)}>
                    Remove
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {editingId === "new" ? (
        <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
          <AddressForm value={draft} onChange={setDraft} />
          {errorMessage && <p className="mt-2 text-sm text-danger">{errorMessage}</p>}
          <div className="mt-3 flex gap-2">
            <Button onClick={save} disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save recipient"}
            </Button>
            <Button variant="secondary" onClick={() => setEditingId(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button className="self-start" onClick={() => startEdit(null)}>
          Add recipient
        </Button>
      )}
    </div>
  );
}
