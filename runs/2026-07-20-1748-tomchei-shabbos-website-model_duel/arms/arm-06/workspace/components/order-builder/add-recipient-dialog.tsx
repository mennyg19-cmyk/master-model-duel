"use client";

import { useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AddressFields, AddressFieldValues } from "@/components/ui/address-fields";
import { BookAddress, RecipientState } from "./types";
import { newClientId } from "./draft-reducer";

const EMPTY_ADDRESS_FIELDS: AddressFieldValues = { line1: "", line2: "", city: "", region: "NJ", postalCode: "" };

// R-028: add-recipient form. Address autocomplete suggests from the
// customer's own book as they type (R-025); submit runs server validation
// before the recipient lands on the draft, and an undeliverable ZIP blocks
// the add — recipients must be deliverable this season.
export function AddRecipientDialog({
  bookAddresses,
  isCustomer,
  onCreated,
  onClose,
}: {
  bookAddresses: BookAddress[];
  isCustomer: boolean;
  onCreated: (recipient: RecipientState) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [fields, setFields] = useState<AddressFieldValues>(EMPTY_ADDRESS_FIELDS);
  const [saveToBook, setSaveToBook] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deliverable, setDeliverable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  // Autocomplete: matches on label/street/city, capped so the list stays a
  // suggestion list rather than a second address book.
  const suggestions = useMemo(() => {
    const query = fields.line1.trim().toLowerCase();
    if (query.length < 2) return [];
    return bookAddresses
      .filter((address) =>
        [address.label ?? "", address.line1, address.city].join(" ").toLowerCase().includes(query),
      )
      .slice(0, 4);
  }, [bookAddresses, fields.line1]);

  function fillFromBook(address: BookAddress) {
    setName(address.label ?? name);
    setFields({
      line1: address.line1,
      line2: address.line2 ?? "",
      city: address.city,
      region: address.region,
      postalCode: address.postalCode,
    });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const validation = await apiFetch<{ deliverable?: boolean }>("/api/addresses/validate", {
      method: "POST",
      body: {
        line1: fields.line1,
        line2: fields.line2 || null,
        city: fields.city,
        region: fields.region,
        postalCode: fields.postalCode,
        country: "US",
      },
    });
    setBusy(false);
    if (!validation.ok) {
      setError(validation.body.error ?? "Address failed validation");
      return;
    }
    setDeliverable(validation.body.deliverable ?? null);
    if (validation.body.deliverable === false) {
      setError("That ZIP is outside this season's delivery area — we can't add a recipient there.");
      return;
    }
    onCreated({
      clientId: newClientId(),
      source: "new",
      name: name.trim(),
      line1: fields.line1.trim(),
      line2: fields.line2.trim() || null,
      city: fields.city.trim(),
      region: fields.region.trim(),
      postalCode: fields.postalCode.trim(),
      country: "US",
      addressId: null,
      saveToBook: isCustomer && saveToBook,
      label: isCustomer && saveToBook ? name.trim() : null,
    });
  }

  const missing =
    !name.trim() || !fields.line1.trim() || !fields.city.trim() || !fields.region.trim() || !fields.postalCode.trim();

  return (
    <Dialog label="Add a new recipient" onClose={onClose} panelClassName="max-w-lg">
      <h2 className="text-lg font-semibold text-stone-900">New recipient</h2>

      <div className="mt-4 flex flex-col gap-3">
        <label className="text-sm text-stone-700">
          Recipient name
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Bubby Sarah" className="mt-1" />
        </label>

        <AddressFields
          values={fields}
          onChange={(field, next) => setFields((current) => ({ ...current, [field]: next }))}
          line1Placeholder={isCustomer ? "Start typing to search your address book" : "123 Main Street"}
          line1Suggestions={
            suggestions.length > 0 ? (
              <ul className="absolute inset-x-0 top-full z-10 mt-1 rounded-md border border-stone-200 bg-white py-1 shadow-lg">
                {suggestions.map((address) => (
                  <li key={address.id}>
                    <button
                      type="button"
                      onClick={() => fillFromBook(address)}
                      className="w-full px-3 py-1.5 text-left text-sm text-stone-700 hover:bg-stone-100"
                    >
                      {address.summary}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null
          }
        />

        {isCustomer && (
          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={saveToBook}
              onChange={(event) => setSaveToBook(event.target.checked)}
              className="h-4 w-4 rounded border-stone-300 text-brand-700 focus:ring-brand-600"
            />
            Save to my address book
          </label>
        )}

        {error && (
          <p className={deliverable === false ? "text-sm text-amber-700" : "text-sm text-red-600"} role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Back
        </Button>
        <Button onClick={submit} disabled={missing || busy} data-add-recipient-submit>
          {busy ? "Checking address…" : "Add recipient"}
        </Button>
      </div>
    </Dialog>
  );
}
