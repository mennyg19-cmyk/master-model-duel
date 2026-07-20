"use client";

import { useState } from "react";
import type { BuilderAddress } from "@/components/order-builder";

export function AddressPicker({
  addresses,
  value,
  onChange,
  onEdit,
}: {
  addresses: BuilderAddress[];
  value: string | null;
  onChange: (addressId: string) => void;
  onEdit: (address: BuilderAddress) => void;
}) {
  const selectedAddress = addresses.find((address) => address.id === value);
  return (
    <>
      <select
        className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2"
        onChange={(event) => onChange(event.target.value)}
        value={value ?? ""}
      >
        <option value="">Choose a recipient</option>
        {addresses.map((address) => (
          <option key={address.id} value={address.id}>
            {address.label ?? address.recipientName} · {address.line1}
          </option>
        ))}
      </select>
      {selectedAddress && (
        <button
          className="mt-2 text-sm font-bold text-[var(--brand)]"
          onClick={() => onEdit(selectedAddress)}
          type="button"
        >
          Edit this address
        </button>
      )}
    </>
  );
}

export function RecipientAddressDialog({
  address,
  draftId,
  onClose,
  onSaved,
}: {
  address: BuilderAddress | null;
  draftId: string | null;
  onClose: () => void;
  onSaved: (address: BuilderAddress) => void;
}) {
  const [error, setError] = useState("");

  async function submitAddress(formData: FormData) {
    setError("");
    const response = await fetch(
      address ? `/api/account/addresses/${address.id}` : "/api/account/addresses",
      {
        method: address ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draftId,
          version: address?.version,
          label: formData.get("label"),
          recipientName: formData.get("recipientName"),
          line1: formData.get("line1"),
          line2: formData.get("line2"),
          city: formData.get("city"),
          region: formData.get("region"),
          postalCode: formData.get("postalCode"),
          countryCode: "US",
        }),
      },
    );
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "Address could not be saved.");
      return;
    }
    onSaved(payload.address);
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center overflow-auto bg-[var(--ink)]/60 p-5"
      role="dialog"
    >
      <form action={submitAddress} className="w-full max-w-xl rounded-[2rem] bg-white p-7">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-black">
            {address ? "Edit recipient" : "Add a recipient"}
          </h2>
          <button onClick={onClose} type="button">Cancel</button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <AddressField autoComplete="nickname" defaultValue={address?.label ?? ""} label="Label" name="label" />
          <AddressField autoComplete="name" defaultValue={address?.recipientName ?? ""} label="Recipient name" name="recipientName" required />
          <div className="sm:col-span-2">
            <AddressField autoComplete="street-address" defaultValue={address?.line1 ?? ""} label="Street address" name="line1" required />
          </div>
          <div className="sm:col-span-2">
            <AddressField autoComplete="address-line2" defaultValue={address?.line2 ?? ""} label="Apartment or suite" name="line2" />
          </div>
          <AddressField autoComplete="address-level2" defaultValue={address?.city ?? ""} label="City" name="city" required />
          <AddressField autoComplete="address-level1" defaultValue={address?.region ?? ""} label="State" name="region" required />
          <AddressField autoComplete="postal-code" defaultValue={address?.postalCode ?? ""} label="Postal code" name="postalCode" required />
        </div>
        {error && <p className="mt-4 text-sm font-bold text-[var(--danger)]">{error}</p>}
        <button
          className="mt-6 w-full rounded-full bg-[var(--brand)] px-6 py-3 font-bold text-white"
          type="submit"
        >
          {address ? "Save changes" : "Save recipient"}
        </button>
      </form>
    </div>
  );
}

function AddressField({
  label,
  ...inputProps
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block text-sm font-bold">
      {label}
      <input
        {...inputProps}
        className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2"
      />
    </label>
  );
}
