"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";

// UR-014: address-book cleanup console on the customer page. Duplicate groups
// pick a keeper and merge the rest; flagged rows confirm after a human look.
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
          <h3 className="text-sm font-medium text-amber-900">Flagged by import — confirm or edit first</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {flagged.map((address) => (
              <li key={address.id} className="flex items-center justify-between rounded-md border border-amber-200 bg-white px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{address.label ?? "Address"}</span>
                  <span className="ml-2 text-stone-600">{addressLine(address)}</span>
                  {address.reviewReason && <span className="ml-2 text-amber-800">({address.reviewReason})</span>}
                </span>
                <Button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => resolve(address.id)}
                  data-resolve-review={address.id}
                >
                  {busy === address.id ? "Confirming…" : "Confirm"}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
