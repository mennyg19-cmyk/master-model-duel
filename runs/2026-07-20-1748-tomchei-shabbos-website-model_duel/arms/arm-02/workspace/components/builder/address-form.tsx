"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import type { AddressInput } from "@/lib/addresses/normalize";
import type { AddressSuggestion } from "@/lib/addresses/autocomplete";

export const EMPTY_ADDRESS: AddressInput = {
  recipient: "",
  line1: "",
  line2: "",
  city: "",
  state: "NJ",
  zip: "",
};

/**
 * Recipient + address fields with street autocomplete (R-025). Used by the
 * builder's assignment dialog and the account address book. Server-side
 * validation is the real gate; this form just collects and suggests.
 */
export function AddressForm({
  value,
  onChange,
  onPickSavedAddress,
}: {
  value: AddressInput;
  onChange: (next: AddressInput) => void;
  /** When a suggestion is one of the customer's saved addresses. */
  onPickSavedAddress?: (addressId: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  function updateField<K extends keyof AddressInput>(field: K, fieldValue: AddressInput[K]) {
    onChange({ ...value, [field]: fieldValue });
  }

  function onLine1Change(line1: string) {
    updateField("line1", line1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (line1.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const response = await fetch(`/api/addresses/autocomplete?q=${encodeURIComponent(line1)}`);
      if (!response.ok) return;
      const body = await response.json();
      setSuggestions(body.suggestions ?? []);
    }, 250);
  }

  function pickSuggestion(suggestion: AddressSuggestion) {
    setSuggestions([]);
    if (suggestion.source === "address-book" && suggestion.addressId && onPickSavedAddress) {
      onPickSavedAddress(suggestion.addressId);
      return;
    }
    onChange({
      ...value,
      recipient: suggestion.recipient ?? value.recipient,
      line1: suggestion.line1,
      city: suggestion.city,
      state: suggestion.state,
      zip: suggestion.zip,
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        placeholder="Recipient name"
        aria-label="Recipient name"
        value={value.recipient}
        onChange={(event) => updateField("recipient", event.target.value)}
        required
      />
      <div className="relative">
        <Input
          placeholder="Street address"
          aria-label="Street address"
          className="w-full"
          value={value.line1}
          onChange={(event) => onLine1Change(event.target.value)}
          autoComplete="off"
          required
        />
        {suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded-md border border-border bg-surface shadow-lg">
            {suggestions.map((suggestion, index) => (
              <li key={`${suggestion.line1}-${index}`}>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-brand-soft"
                  onClick={() => pickSuggestion(suggestion)}
                >
                  {suggestion.source === "address-book" ? (
                    <span className="font-medium">{suggestion.recipient} — </span>
                  ) : null}
                  {suggestion.line1}, {suggestion.city}, {suggestion.state} {suggestion.zip}
                  {suggestion.source === "address-book" && (
                    <span className="ml-1 text-xs text-muted">(saved)</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Input
        placeholder="Apt, suite, etc. (optional)"
        aria-label="Address line 2"
        value={value.line2 ?? ""}
        onChange={(event) => updateField("line2", event.target.value)}
      />
      <div className="grid grid-cols-[1fr_4rem_6rem] gap-2">
        <Input
          placeholder="City"
          aria-label="City"
          value={value.city}
          onChange={(event) => updateField("city", event.target.value)}
          required
        />
        <Input
          placeholder="NJ"
          aria-label="State"
          maxLength={2}
          value={value.state}
          onChange={(event) => updateField("state", event.target.value.toUpperCase())}
          required
        />
        <Input
          placeholder="ZIP"
          aria-label="ZIP code"
          maxLength={5}
          value={value.zip}
          onChange={(event) => updateField("zip", event.target.value.replace(/\D/g, ""))}
          required
        />
      </div>
    </div>
  );
}
