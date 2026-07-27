"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";

export type PosCustomer = { id: string; name: string; email: string; phone: string | null };

/** POS step 1: find the customer (staff search API) or create the walk-in. */
export function CustomerPicker({
  onSelect,
  error,
}: {
  onSelect: (customer: PosCustomer) => void;
  error: string | null;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosCustomer[]>([]);
  const [searched, setSearched] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", email: "", phone: "" });
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    try {
      const result = await apiFetch<{ customers: PosCustomer[] }>(
        `/api/admin/customers?q=${encodeURIComponent(query.trim())}`
      );
      setResults(result.ok ? result.body.customers : []);
      setSearched(true);
    } finally {
      setBusy(false);
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setCreateError(null);
    setBusy(true);
    try {
      const result = await apiFetch<{ customer: PosCustomer }>("/api/admin/customers", {
        method: "POST",
        body: {
          name: createForm.name,
          email: createForm.email,
          phone: createForm.phone || undefined,
        },
      });
      if (!result.ok) {
        setCreateError(result.error);
        return;
      }
      onSelect(result.body.customer);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid max-w-3xl gap-4 md:grid-cols-2">
      <Card>
        <CardTitle className="mb-3">Find customer</CardTitle>
        <form onSubmit={search} className="flex gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, email, or phone"
            className="flex-1 rounded-md border border-border bg-white px-3 py-1.5 text-sm text-ink"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
          >
            Search
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <ul className="mt-3 space-y-1 text-sm">
          {results.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                onClick={() => onSelect(result)}
                className="w-full rounded-md border border-border px-3 py-2 text-left hover:bg-brand-soft"
              >
                <span className="font-medium">{result.name}</span>{" "}
                <span className="text-muted">
                  {result.email}
                  {result.phone ? ` · ${result.phone}` : ""}
                </span>
              </button>
            </li>
          ))}
          {searched && results.length === 0 && <li className="text-muted">No matches — create them on the right.</li>}
        </ul>
      </Card>

      <Card>
        <CardTitle className="mb-3">New walk-in customer</CardTitle>
        <form onSubmit={create} className="space-y-2 text-sm">
          <input
            required
            value={createForm.name}
            onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })}
            placeholder="Full name"
            className="w-full rounded-md border border-border bg-white px-3 py-1.5 text-ink"
          />
          <input
            required
            type="email"
            value={createForm.email}
            onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })}
            placeholder="Email"
            className="w-full rounded-md border border-border bg-white px-3 py-1.5 text-ink"
          />
          <input
            value={createForm.phone}
            onChange={(event) => setCreateForm({ ...createForm, phone: event.target.value })}
            placeholder="Phone (optional)"
            className="w-full rounded-md border border-border bg-white px-3 py-1.5 text-ink"
          />
          {createError && <p className="text-danger">{createError}</p>}
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-brand px-4 py-1.5 font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
          >
            Create and start order
          </button>
        </form>
      </Card>
    </div>
  );
}
