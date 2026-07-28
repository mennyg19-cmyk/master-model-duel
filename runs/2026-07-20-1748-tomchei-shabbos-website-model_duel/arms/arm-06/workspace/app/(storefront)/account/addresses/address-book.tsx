"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AddressFields, AddressFieldValues } from "@/components/ui/address-fields";
import { BookAddress } from "@/components/order-builder/types";
import { EditSavedAddressDialog } from "@/components/order-builder/edit-saved-address-dialog";

// Account address-book manager: list + add/edit/delete against the
// ownership-enforced /api/account/addresses routes.
export function AddressBook({ initialAddresses }: { initialAddresses: BookAddress[] }) {
  const [addresses, setAddresses] = useState(initialAddresses);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BookAddress | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(address: BookAddress) {
    if (!window.confirm(`Delete "${address.label ?? address.line1}" from your address book?`)) return;
    setError(null);
    const deleteResult = await apiFetch(`/api/account/addresses/${address.id}`, { method: "DELETE" });
    if (!deleteResult.ok) {
      setError(deleteResult.body.error ?? "Could not delete the address");
      return;
    }
    setAddresses((list) => list.filter((candidate) => candidate.id !== address.id));
  }

  return (
    <div className="mt-5">
      {addresses.length === 0 ? (
        <p className="text-sm text-stone-500">No saved addresses yet — add one, or add a recipient while ordering.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {addresses.map((address) => (
            <li
              key={address.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-stone-200 px-4 py-3"
              data-address-row={address.label ?? address.line1}
            >
              <div className="text-sm">
                <span className="font-medium text-stone-900">{address.label ?? address.line1}</span>
                <span className="text-stone-500"> · {address.summary}</span>
              </div>
              <div className="flex gap-3 text-sm">
                <button
                  type="button"
                  onClick={() => setEditing(address)}
                  className="font-medium text-brand-700 hover:underline"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => remove(address)}
                  className="text-red-600 hover:underline"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <Button variant="secondary" className="mt-4" onClick={() => setAdding(true)} data-add-address>
        Add an address
      </Button>

      {adding && (
        <AddAddressDialog
          onCreated={(created) => {
            setAddresses((list) =>
              list.some((candidate) => candidate.id === created.id)
                ? list.map((candidate) => (candidate.id === created.id ? created : candidate))
                : [...list, created],
            );
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      )}

      {editing && (
        <EditSavedAddressDialog
          address={editing}
          onSaved={(updated) =>
            setAddresses((list) => list.map((candidate) => (candidate.id === updated.id ? updated : candidate)))
          }
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function AddAddressDialog({
  onCreated,
  onClose,
}: {
  onCreated: (address: BookAddress) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  const [fields, setFields] = useState<AddressFieldValues>({ line1: "", line2: "", city: "", region: "NJ", postalCode: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const saveResult = await apiFetch<{ address?: BookAddress; deduped?: boolean }>("/api/account/addresses", {
      method: "POST",
      body: {
        label: label || null,
        line1: fields.line1,
        line2: fields.line2 || null,
        city: fields.city,
        region: fields.region,
        postalCode: fields.postalCode,
        country: "US",
      },
    });
    setBusy(false);
    if (!saveResult.ok || !saveResult.body.address) {
      setError(saveResult.body.error ?? "Could not save the address");
      return;
    }
    onCreated(saveResult.body.address);
  }

  const missing = !fields.line1.trim() || !fields.city.trim() || !fields.region.trim() || !fields.postalCode.trim();

  return (
    <Dialog label="Add an address" onClose={onClose} panelClassName="max-w-lg">
      <h2 className="text-lg font-semibold text-stone-900">Add an address</h2>
      <div className="mt-4 flex flex-col gap-3">
        <label className="text-sm text-stone-700">
          Label (e.g. Home, Bubby)
          <Input value={label} onChange={(event) => setLabel(event.target.value)} className="mt-1" />
        </label>
        <AddressFields
          values={fields}
          onChange={(field, next) => setFields((current) => ({ ...current, [field]: next }))}
        />
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={missing || busy}>
          {busy ? "Saving…" : "Save address"}
        </Button>
      </div>
    </Dialog>
  );
}
