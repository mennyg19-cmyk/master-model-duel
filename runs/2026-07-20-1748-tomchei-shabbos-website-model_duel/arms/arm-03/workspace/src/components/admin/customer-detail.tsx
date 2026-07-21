"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type CustomerDetail = {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  addresses: Array<{
    id: string;
    recipientName: string;
    line1: string;
    city: string;
    state: string;
    postalCode: string;
  }>;
  orders: Array<{
    id: string;
    orderNumber: number | null;
    status: string;
    paymentStatusCached: string;
    expectedTotalCents: number | null;
    season: { name: string; year: number };
  }>;
};

export function CustomerDetailClient({ customerId }: { customerId: string }) {
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/admin/customers/${customerId}`);
      const json = await res.json();
      if (res.ok) setCustomer(json.customer);
    })();
  }, [customerId]);

  if (!customer) return <p className="text-sm">Loading…</p>;

  return (
    <div className="space-y-4" data-testid="customer-detail">
      <Link href="/admin/customers" className="text-sm font-semibold text-[var(--color-leaf)]">
        ← Customers
      </Link>
      <header className="rounded bg-white p-5 shadow-sm">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
          {customer.displayName}
        </h1>
        <p className="mt-1 text-sm opacity-70">
          {customer.email ?? "no email"} · {customer.phone ?? "no phone"}
        </p>
      </header>
      <section className="rounded bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Addresses</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {customer.addresses.map((a) => (
            <li key={a.id}>
              {a.recipientName} — {a.line1}, {a.city} {a.state} {a.postalCode}
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Order history</h2>
        <ul className="mt-2 divide-y text-sm">
          {customer.orders.map((o) => (
            <li key={o.id} className="flex justify-between py-2">
              <Link className="underline" href={`/admin/orders/${o.id}`}>
                #{o.orderNumber ?? "—"} · {o.season.name} {o.season.year}
              </Link>
              <span className="text-xs opacity-70">
                {o.status} · {o.paymentStatusCached}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
