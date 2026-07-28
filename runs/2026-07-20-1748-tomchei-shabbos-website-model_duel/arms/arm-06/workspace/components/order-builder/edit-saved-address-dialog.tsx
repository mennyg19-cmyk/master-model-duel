"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AddressFields, AddressFieldValues } from "@/components/ui/address-fields";
import { BookAddress } from "./types";

// R-029: edit a saved address mid-order. Runs the same deliverability probe
// as add-recipient before PATCHing (an edit can't move a book entry outside
// the delivery area), then PATCHes the customer's own book row
// (ownership-enforced server-side); the shell refreshes its local book copy
// from the response.
export function EditSavedAddressDialog({
  address,
  onSaved,
  onClose,
}: {
  address: BookAddress;
  onSaved: (updated: BookAddress) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(address.label ?? "");
  const [fields, setFields] = useState<AddressFieldValues>({
    line1: address.line1,
    line2: address.line2 ?? "",
    city: address.city,
    region: address.region,
    postalCode: address.postalCode,
  });
  const [error, setError] = useState<string | null>(null);
  const [deliverable, setDeliverable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

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
        country: address.country,
      },
    });
    if (!validation.ok) {
      setBusy(false);
      setError(validation.body.error ?? "Address failed validation");
      return;
    }
    setDeliverable(validation.body.deliverable ?? null);
    if (validation.body.deliverable === false) {
      setBusy(false);
      setError("That ZIP is outside this season's delivery area — choose an address inside it.");
      return;
    }

    const saveResult = await apiFetch<{ address?: BookAddress }>(`/api/account/addresses/${address.id}`, {
      method: "PATCH",
      body: {
        label: label || null,
        line1: fields.line1,
        line2: fields.line2 || null,
        city: fields.city,
        region: fields.region,
        postalCode: fields.postalCode,
        country: address.country,
      },
    });
    setBusy(false);
    if (!saveResult.ok || !saveResult.body.address) {
      setError(saveResult.body.error ?? "Could not save the address");
      return;
    }
    onSaved(saveResult.body.address);
    onClose();
  }

  const missing = !fields.line1.trim() || !fields.city.trim() || !fields.region.trim() || !fields.postalCode.trim();

  return (
    <Dialog label={`Edit saved address ${address.label ?? address.line1}`} onClose={onClose} panelClassName="max-w-lg">
      <h2 className="text-lg font-semibold text-stone-900">Edit saved address</h2>

      <div className="mt-4 flex flex-col gap-3">
        <label className="text-sm text-stone-700">
          Label
          <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Home" className="mt-1" />
        </label>
        <AddressFields
          values={fields}
          onChange={(field, next) => setFields((current) => ({ ...current, [field]: next }))}
        />
        {error && (
          <p className={deliverable === false ? "text-sm text-amber-700" : "text-sm text-red-600"} role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={missing || busy} data-edit-address-submit>
          {busy ? "Saving…" : "Save address"}
        </Button>
      </div>
    </Dialog>
  );
}
