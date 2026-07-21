"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

type SavedAddress = {
  id: string;
  label: string | null;
  recipientName: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  isDefault: boolean;
};

type Suggestion = {
  label: string;
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

const AUTOCOMPLETE_DEBOUNCE_MS = 200;

export function AssignDialog({
  addresses,
  signedIn,
  onClose,
  onAssign,
  onAddressesChange,
}: {
  addresses: SavedAddress[];
  signedIn: boolean;
  onClose: () => void;
  onAssign: (payload: {
    mode: "on_order" | "address_book" | "new_recipient";
    savedAddressId?: string;
    newRecipient?: Record<string, unknown>;
  }) => Promise<void>;
  /** Refresh address book after mid-order edit (EXPECTED #2 / M8). */
  onAddressesChange?: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"on_order" | "address_book" | "new_recipient">(
    signedIn ? "on_order" : "new_recipient",
  );
  const [savedAddressId, setSavedAddressId] = useState(addresses[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [editingSaved, setEditingSaved] = useState(false);
  const [form, setForm] = useState({
    recipientName: "",
    line1: "",
    line2: "",
    city: "",
    state: "NY",
    postalCode: "",
    label: "",
  });

  const selected = addresses.find((a) => a.id === savedAddressId) ?? addresses[0];

  useEffect(() => {
    if (!addresses.some((a) => a.id === savedAddressId) && addresses[0]) {
      setSavedAddressId(addresses[0].id);
    }
  }, [addresses, savedAddressId]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/addresses/autocomplete?q=${encodeURIComponent(query)}`);
      const json = await res.json();
      if (json.ok) setSuggestions(json.suggestions);
    }, AUTOCOMPLETE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  function beginEditSaved() {
    if (!selected) return;
    setForm({
      recipientName: selected.recipientName,
      line1: selected.line1,
      line2: selected.line2 ?? "",
      city: selected.city,
      state: selected.state,
      postalCode: selected.postalCode,
      label: selected.label ?? "",
    });
    setEditingSaved(true);
    setError(null);
  }

  async function saveEditedAddress() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/addresses/${selected.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          line2: form.line2 || null,
          isDefault: selected.isDefault,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setError(typeof json.error === "string" ? json.error : "Could not update address.");
        return;
      }
      setEditingSaved(false);
      await onAddressesChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "on_order") {
        await onAssign({ mode: "on_order" });
      } else if (mode === "address_book") {
        if (editingSaved) {
          await saveEditedAddress();
          return;
        }
        await onAssign({ mode: "address_book", savedAddressId });
      } else {
        const validate = await fetch("/api/addresses/autocomplete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(form),
        });
        const v = await validate.json();
        if (!v.ok) {
          setError(typeof v.error === "string" ? v.error : "Address invalid");
          return;
        }
        await onAssign({
          mode: "new_recipient",
          newRecipient: { ...form, isDefault: false },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="assign-dialog"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-[var(--radius-lg)] bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-[family-name:var(--font-display)] text-2xl text-[var(--color-forest)]">
          Assign recipient
        </h2>
        <p className="mt-1 text-sm text-[var(--color-ink)]/70">
          Three-way picker: on this order (self), address book, or new recipient.
        </p>

        <div className="mt-4 flex flex-wrap gap-2" data-testid="assign-mode-picker">
          {(
            [
              ["on_order", "On order (self)"],
              ["address_book", "Address book"],
              ["new_recipient", "New recipient"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              disabled={value !== "new_recipient" && !signedIn}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                mode === value
                  ? "bg-[var(--color-leaf)] text-white"
                  : "border border-[var(--color-forest)]/20"
              } disabled:opacity-40`}
              onClick={() => {
                setMode(value);
                setEditingSaved(false);
              }}
              data-testid={`mode-${value}`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "address_book" ? (
          <div className="mt-4 space-y-3" data-testid="address-book-panel">
            <label className="block text-sm">
              <span className="font-semibold">Saved recipient</span>
              <select
                className="mt-1 w-full rounded-[var(--radius-md)] border px-3 py-2"
                value={savedAddressId}
                onChange={(e) => {
                  setSavedAddressId(e.target.value);
                  setEditingSaved(false);
                }}
                data-testid="saved-address-select"
              >
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label || a.recipientName} — {a.line1}, {a.city}
                  </option>
                ))}
              </select>
            </label>
            {!editingSaved && selected ? (
              <div className="flex items-start justify-between gap-2 rounded border border-[var(--color-forest)]/15 bg-[var(--color-cream)] px-3 py-2 text-sm">
                <div>
                  <p className="font-semibold">{selected.recipientName}</p>
                  <p className="text-[var(--color-ink)]/70">
                    {selected.line1}
                    {selected.line2 ? `, ${selected.line2}` : ""}
                    <br />
                    {selected.city}, {selected.state} {selected.postalCode}
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-sm font-semibold text-[var(--color-leaf)] underline"
                  onClick={beginEditSaved}
                  data-testid="edit-saved-address"
                >
                  Edit address
                </button>
              </div>
            ) : null}
            {editingSaved ? (
              <div className="space-y-2" data-testid="edit-saved-address-form">
                <Input
                  placeholder="Recipient name"
                  value={form.recipientName}
                  onChange={(e) => setForm((f) => ({ ...f, recipientName: e.target.value }))}
                  data-testid="edit-recipient-name"
                />
                <Input
                  placeholder="Street"
                  value={form.line1}
                  onChange={(e) => setForm((f) => ({ ...f, line1: e.target.value }))}
                  data-testid="edit-line1"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="City"
                    value={form.city}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                    data-testid="edit-city"
                  />
                  <Input
                    placeholder="State"
                    value={form.state}
                    onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                    data-testid="edit-state"
                  />
                </div>
                <Input
                  placeholder="ZIP"
                  value={form.postalCode}
                  onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))}
                  data-testid="edit-postal"
                />
                <Input
                  placeholder="Label (optional)"
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                />
                <button
                  type="button"
                  className="text-sm font-semibold underline"
                  onClick={() => setEditingSaved(false)}
                >
                  Cancel edit
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {mode === "new_recipient" ? (
          <div className="mt-4 space-y-3" data-testid="add-recipient-form">
            <Input
              placeholder="Recipient name"
              value={form.recipientName}
              onChange={(e) => setForm((f) => ({ ...f, recipientName: e.target.value }))}
              data-testid="recipient-name"
            />
            <Input
              placeholder="Start typing an address…"
              value={query || form.line1}
              onChange={(e) => {
                setQuery(e.target.value);
                setForm((f) => ({ ...f, line1: e.target.value }));
              }}
              data-testid="address-autocomplete"
            />
            {suggestions.length > 0 ? (
              <ul className="rounded border bg-[var(--color-cream)] text-sm" data-testid="autocomplete-list">
                {suggestions.map((s) => (
                  <li key={s.label}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left hover:bg-white"
                      onClick={() => {
                        setForm((f) => ({
                          ...f,
                          line1: s.line1,
                          city: s.city,
                          state: s.state,
                          postalCode: s.postalCode,
                        }));
                        setQuery(s.line1);
                        setSuggestions([]);
                      }}
                    >
                      {s.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="City"
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                data-testid="city"
              />
              <Input
                placeholder="State"
                value={form.state}
                onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                data-testid="state"
              />
            </div>
            <Input
              placeholder="ZIP"
              value={form.postalCode}
              onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))}
              data-testid="postal"
            />
            <Input
              placeholder="Label (optional)"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
          </div>
        ) : null}

        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-2 text-sm font-semibold" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-[var(--radius-md)] bg-[var(--color-leaf)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
            onClick={submit}
            data-testid="assign-submit"
          >
            {mode === "address_book" && editingSaved ? "Save address" : "Save assignment"}
          </button>
        </div>
      </div>
    </div>
  );
}
