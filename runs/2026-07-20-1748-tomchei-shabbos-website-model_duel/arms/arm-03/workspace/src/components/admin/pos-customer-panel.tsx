"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Customer = {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
};

export function PosCustomerPanel({
  draftRef,
  onAttached,
}: {
  draftRef: string | null;
  onAttached?: (customer: Customer) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Customer[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [attached, setAttached] = useState<Customer | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/admin/customers?pos=1&q=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (res.ok) setHits(json.customers);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  async function attach(customerId: string) {
    if (!draftRef) {
      setMessage("Create a POS draft first (add a product).");
      return;
    }
    setMessage(null);
    const res = await fetch("/api/admin/pos/attach-customer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftRef, customerId }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error || "Attach failed");
      return;
    }
    setAttached(json.customer);
    onAttached?.(json.customer);
    setMessage(`Attached ${json.customer.displayName}`);
  }

  async function findOrCreate() {
    if (!draftRef) {
      setMessage("Create a POS draft first (add a product).");
      return;
    }
    setMessage(null);
    const res = await fetch("/api/admin/pos/attach-customer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draftRef,
        displayName: name,
        email: email || null,
        phone: phone || null,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error || "Find/create failed");
      return;
    }
    setAttached(json.customer);
    onAttached?.(json.customer);
    setMessage(`Attached ${json.customer.displayName}`);
  }

  return (
    <div className="rounded border border-[var(--color-forest)]/15 bg-white p-4 shadow-sm" data-testid="pos-customer-panel">
      <h2 className="text-sm font-semibold text-[var(--color-forest)]">Customer lookup</h2>
      <p className="mt-1 text-xs opacity-70">Find or create walk-in, then attach to this POS draft.</p>
      <input
        className="mt-3 w-full rounded border px-3 py-2 text-sm"
        placeholder="Search customers…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        data-testid="pos-customer-search"
      />
      {hits.length > 0 ? (
        <ul className="mt-2 max-h-40 overflow-auto rounded border text-sm" data-testid="pos-customer-hits">
          {hits.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left hover:bg-[var(--color-cream)]"
                onClick={() => attach(c.id)}
              >
                {c.displayName} · {c.email ?? c.phone ?? "—"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <input
          className="rounded border px-2 py-1.5 text-sm"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="pos-new-name"
        />
        <input
          className="rounded border px-2 py-1.5 text-sm"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="pos-new-email"
        />
        <input
          className="rounded border px-2 py-1.5 text-sm"
          placeholder="Phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          data-testid="pos-new-phone"
        />
      </div>
      <Button type="button" className="mt-2" onClick={findOrCreate} data-testid="pos-find-or-create">
        Find or create + attach
      </Button>
      {attached ? (
        <p className="mt-2 text-sm font-semibold" data-testid="pos-attached-customer">
          Attached: {attached.displayName}
        </p>
      ) : null}
      {message ? <p className="mt-2 text-xs">{message}</p> : null}
    </div>
  );
}
