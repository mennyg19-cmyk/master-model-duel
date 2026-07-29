"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { BookAddress, BuilderProduct } from "@/components/order-builder/types";
import { OrderBuilderShell } from "@/components/order-builder/order-builder-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CustomerHit {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

// R-059/R-060: step 1 is always the customer — search the directory (bounded
// top matches) or find-or-create on the spot. Step 2 mounts the shared order
// builder against that customer; step 3 is the POS checkout page.
export function PosShell({ products }: { products: BuilderProduct[] }) {
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [bookAddresses, setBookAddresses] = useState<BookAddress[]>([]);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced directory search — one in-flight request at a time, stale
  // responses discarded by query generation.
  const generation = useRef(0);
  useEffect(() => {
    if (customer) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      const gen = ++generation.current;
      setSearching(true);
      const result = await apiFetch<{ customers?: CustomerHit[] }>(
        `/api/admin/customers?q=${encodeURIComponent(q)}`,
      );
      if (gen !== generation.current) return;
      setSearching(false);
      setHits(result.ok ? (result.body.customers ?? []) : []);
    }, 250);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, customer]);

  async function pickCustomer(hit: CustomerHit) {
    setError(null);
    setAddressError(null);
    const addresses = await apiFetch<{ addresses?: BookAddress[] }>(`/api/admin/customers/${hit.id}/addresses`);
    if (addresses.ok) {
      setBookAddresses(addresses.body.addresses ?? []);
    } else {
      setBookAddresses([]);
      setAddressError("Could not load this customer's address book — type the address manually.");
    }
    setCustomer(hit);
  }

  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    const result = await apiFetch<{ customer?: CustomerHit; created?: boolean }>("/api/admin/customers", {
      method: "POST",
      body: {
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        phone: String(form.get("phone") ?? "") || null,
      },
    });
    if (!result.ok || !result.body.customer) {
      setError(result.body.error ?? "Could not create the customer");
      return;
    }
    await pickCustomer(result.body.customer);
  }

  if (customer) {
    return (
      <div className="mt-4">
        <div className="mb-4 flex items-center gap-3 rounded-md border border-stone-200 bg-white px-4 py-3" data-pos-customer>
          <span className="text-sm">
            Counter customer: <strong>{customer.name}</strong> · {customer.email}
            {customer.phone ? ` · ${customer.phone}` : ""}
            {addressError && <span className="ml-2 text-amber-700">{addressError}</span>}
          </span>
          <button
            type="button"
            className="text-sm font-medium text-brand-700 hover:underline"
            onClick={() => {
              setCustomer(null);
              setBookAddresses([]);
            }}
            data-pos-change-customer
          >
            Change
          </button>
        </div>
        <OrderBuilderShell
          key={customer.id}
          products={products}
          bookAddresses={bookAddresses}
          viewer={{ kind: "customer", name: customer.name, email: customer.email }}
          initialDraft={null}
          pos={{ customerId: customer.id, saveUrl: "/api/admin/pos/draft", checkoutUrl: "/admin/pos/checkout" }}
        />
      </div>
    );
  }

  return (
    <div className="mt-6 max-w-2xl" data-pos-lookup>
      <Label htmlFor="pos-search">Find the counter customer</Label>
      <Input
        id="pos-search"
        className="mt-1 w-full"
        placeholder="Name, email, or phone…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
        data-pos-search
      />
      {searching && <p className="mt-2 text-sm text-stone-500">Searching…</p>}

      {hits.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2" data-pos-hits>
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                className="w-full rounded-md border border-stone-200 bg-white px-4 py-2.5 text-left text-sm hover:border-brand-300"
                onClick={() => pickCustomer(hit)}
                data-pos-hit={hit.id}
              >
                <span className="font-medium text-stone-900">{hit.name}</span>
                <span className="ml-2 text-stone-600">
                  {hit.email}
                  {hit.phone ? ` · ${hit.phone}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim() && !searching && hits.length === 0 && (
        <p className="mt-3 text-sm text-stone-500">No matches — create the customer below.</p>
      )}

      <div className="mt-5">
        {!createOpen ? (
          <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)} data-pos-new-toggle>
            New customer
          </Button>
        ) : (
          <form onSubmit={createCustomer} className="rounded-md border border-stone-200 bg-white p-4" data-pos-create>
            <h2 className="text-sm font-semibold">New counter customer</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="pos-name">Name</Label>
                <Input id="pos-name" name="name" required className="mt-1 w-full" />
              </div>
              <div>
                <Label htmlFor="pos-email">Email</Label>
                <Input id="pos-email" name="email" type="email" required className="mt-1 w-full" />
              </div>
              <div>
                <Label htmlFor="pos-phone">Phone (optional)</Label>
                <Input id="pos-phone" name="phone" className="mt-1 w-full" />
              </div>
            </div>
            <p className="mt-2 text-xs text-stone-500">
              An existing email or phone attaches to that customer instead of duplicating them.
            </p>
            <Button type="submit" size="sm" className="mt-3">
              Start order for this customer
            </Button>
          </form>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
