"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

type Address = {
  id: string;
  label: string | null;
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  geocodeStatus: string | null;
  addressNorm: string;
};

export default function AccountAddressesPage() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [editing, setEditing] = useState<Address | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/addresses");
    const json = await res.json();
    if (!json.ok) {
      setError(json.error || "Sign in required");
      return;
    }
    setAddresses(json.addresses);
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!editing) return;
    const res = await fetch(`/api/addresses/${editing.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(editing),
    });
    const json = await res.json();
    if (!json.ok) {
      setError(typeof json.error === "string" ? json.error : "Save failed");
      return;
    }
    setEditing(null);
    await load();
  }

  if (error && addresses.length === 0) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <p>{error}</p>
        <Link href="/account" className="mt-4 inline-block text-sm font-semibold">
          Back
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10" data-testid="account-addresses-page">
      <div className="flex items-center justify-between">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
          Saved addresses
        </h1>
        <Link href="/account" className="text-sm font-semibold">
          Back
        </Link>
      </div>
      <ul className="space-y-3">
        {addresses.map((a) => (
          <li key={a.id} className="rounded border bg-white p-4">
            <p className="font-semibold">{a.label || a.recipientName}</p>
            <p className="text-sm">
              {a.line1}, {a.city} {a.state} {a.postalCode}
            </p>
            <button
              type="button"
              className="mt-2 text-sm font-semibold text-[var(--color-leaf)]"
              onClick={() => setEditing(a)}
              data-testid={`edit-addr-${a.id}`}
            >
              Edit
            </button>
          </li>
        ))}
      </ul>

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-5" data-testid="edit-address-dialog">
            <h2 className="font-semibold">Edit address</h2>
            <Input
              value={editing.recipientName}
              onChange={(e) => setEditing({ ...editing, recipientName: e.target.value })}
              data-testid="edit-recipient"
            />
            <Input
              value={editing.line1}
              onChange={(e) => setEditing({ ...editing, line1: e.target.value })}
              data-testid="edit-line1"
            />
            <Input
              value={editing.city}
              onChange={(e) => setEditing({ ...editing, city: e.target.value })}
            />
            <Input
              value={editing.state}
              onChange={(e) => setEditing({ ...editing, state: e.target.value })}
            />
            <Input
              value={editing.postalCode}
              onChange={(e) => setEditing({ ...editing, postalCode: e.target.value })}
            />
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="rounded bg-[var(--color-leaf)] px-3 py-2 text-sm font-semibold text-white"
                onClick={save}
                data-testid="edit-address-save"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
