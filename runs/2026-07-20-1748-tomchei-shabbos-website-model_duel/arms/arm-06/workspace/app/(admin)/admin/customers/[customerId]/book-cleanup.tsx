"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";

// UR-014: address-book cleanup console on the customer page. Duplicate groups
// pick a keeper and merge the rest; flagged rows confirm after a human look —
// or get corrected first through the same audited staff PATCH the order
// builder uses, then confirmed (the edit-first workflow).
export interface CleanupAddress {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string;
  reviewReason: string | null;
}

export interface CleanupGroup {
  key: string;
  addresses: CleanupAddress[];
}

function addressLine(address: CleanupAddress): string {
  return `${address.line1}${address.line2 ? `, ${address.line2}` : ""}, ${address.city}, ${address.region} ${address.postalCode}`;
}

function FlaggedEditor({
  address,
  busy,
  onSave,
  onCancel,
}: {
  address: CleanupAddress;
  busy: boolean;
  onSave: (draft: Omit<CleanupAddress, "id" | "reviewReason">) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState({
    label: address.label ?? "",
    line1: address.line1,
    line2: address.line2 ?? "",
    city: address.city,
    region: address.region,
    postalCode: address.postalCode,
  });
  const field = (key: keyof typeof draft, placeholder: string, className: string) => (
    <input
      type="text"
      className={`rounded-md border border-stone-300 px-2 py-1 text-sm ${className}`}
      value={draft[key]}
      placeholder={placeholder}
      onChange={(event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }))}
      data-flag-edit={key}
    />
  );
  return (
    <div className="mt-2 flex flex-col gap-2" data-flag-editor={address.id}>
      <div className="flex flex-wrap gap-2">
        {field("label", "Label", "w-28")}
        {field("line1", "Street", "w-48")}
        {field("line2", "Apt / line 2", "w-28")}
      </div>
      <div className="flex flex-wrap gap-2">
        {field("city", "City", "w-32")}
        {field("region", "State", "w-16")}
        {field("postalCode", "ZIP", "w-24")}
        <Button type="button" size="sm" disabled={busy} onClick={() => onSave(draft)} data-flag-edit-save={address.id}>
          {busy ? "Saving…" : "Save correction"}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function BookCleanup({
  customerId,
  duplicates,
  flagged,
}: {
  customerId: string;
  duplicates: CleanupGroup[];
  flagged: CleanupAddress[];
}) {
  const router = useRouter();
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  async function merge(group: CleanupGroup) {
    const keepId = keep[group.key] ?? group.addresses[0].id;
    setBusy(group.key);
    setError(null);
    const result = await apiFetch(`/api/admin/customers/${customerId}/addresses/merge`, {
      method: "POST",
      body: { keepId, dropIds: group.addresses.filter((a) => a.id !== keepId).map((a) => a.id) },
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.body.error ?? "Merge failed");
      return;
    }
    router.refresh();
  }

  async function resolve(addressId: string) {
    setBusy(addressId);
    setError(null);
    const result = await apiFetch(`/api/admin/customers/${customerId}/addresses/${addressId}/resolve-review`, {
      method: "POST",
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.body.error ?? "Could not confirm the address");
      return;
    }
    router.refresh();
  }

  async function saveCorrection(addressId: string, draft: Omit<CleanupAddress, "id" | "reviewReason">) {
    setBusy(addressId);
    setError(null);
    const result = await apiFetch(`/api/admin/customers/${customerId}/addresses/${addressId}`, {
      method: "PATCH",
      body: {
        label: draft.label || null,
        line1: draft.line1,
        line2: draft.line2 || null,
        city: draft.city,
        region: draft.region,
        postalCode: draft.postalCode,
        country: "US",
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.body.error ?? "Could not save the correction");
      return;
    }
    setEditing(null);
    router.refresh();
  }

  if (duplicates.length === 0 && flagged.length === 0) return null;

  return (
    <section className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-5" data-book-cleanup>
      <h2 className="text-lg font-semibold text-amber-900">Address-book cleanup</h2>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

      {duplicates.length > 0 && (
        <div className="mt-3">
          <h3 className="text-sm font-medium text-amber-900">Possible duplicates — pick the keeper, merge the rest</h3>
          <ul className="mt-2 flex flex-col gap-3">
            {duplicates.map((group) => (
              <li key={group.key} className="rounded-md border border-amber-200 bg-white px-3 py-2">
                {group.addresses.map((address) => (
                  <label key={address.id} className="flex items-center gap-2 py-1 text-sm">
                    <input
                      type="radio"
                      name={`keep-${group.key}`}
                      checked={(keep[group.key] ?? group.addresses[0].id) === address.id}
                      onChange={() => setKeep((prev) => ({ ...prev, [group.key]: address.id }))}
                    />
                    <span className="font-medium">{address.label ?? "Address"}</span>
                    <span className="text-stone-600">{addressLine(address)}</span>
                  </label>
                ))}
                <Button
                  type="button"
                  className="mt-2"
                  disabled={busy !== null}
                  onClick={() => merge(group)}
                  data-merge-group={group.key}
                >
                  {busy === group.key ? "Merging…" : "Merge others into selected"}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {flagged.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-amber-900">Flagged by import — confirm as-is, or correct first and then confirm</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {flagged.map((address) => (
              <li key={address.id} className="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span>
                    <span className="font-medium">{address.label ?? "Address"}</span>
                    <span className="ml-2 text-stone-600">{addressLine(address)}</span>
                    {address.reviewReason && <span className="ml-2 text-amber-800">({address.reviewReason})</span>}
                  </span>
                  <span className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => setEditing(editing === address.id ? null : address.id)}
                      data-edit-flagged={address.id}
                    >
                      {editing === address.id ? "Close editor" : "Edit"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => resolve(address.id)}
                      data-resolve-review={address.id}
                    >
                      {busy === address.id ? "Confirming…" : "Confirm"}
                    </Button>
                  </span>
                </div>
                {editing === address.id && (
                  <FlaggedEditor
                    address={address}
                    busy={busy === address.id}
                    onSave={(draft) => saveCorrection(address.id, draft)}
                    onCancel={() => setEditing(null)}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
