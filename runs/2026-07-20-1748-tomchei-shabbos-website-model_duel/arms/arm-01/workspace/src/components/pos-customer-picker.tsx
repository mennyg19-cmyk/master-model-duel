"use client";

import { useState } from "react";

export function PosCustomerCreator() {
  const [message, setMessage] = useState("");
  async function createCustomer(formData: FormData) {
    const response = await fetch("/api/admin/customers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(formData)),
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error);
      return;
    }
    window.location.assign(`/admin/pos?customerId=${encodeURIComponent(payload.customer.id)}`);
  }
  return (
    <form action={createCustomer} className="grid gap-3 rounded-2xl bg-[var(--surface)] p-4 sm:grid-cols-3">
      <input className="rounded-xl border border-[var(--border)] px-3 py-2" name="displayName" placeholder="Customer name" required />
      <input className="rounded-xl border border-[var(--border)] px-3 py-2" name="email" placeholder="Email" type="email" />
      <input className="rounded-xl border border-[var(--border)] px-3 py-2" name="phone" placeholder="Phone" />
      <button className="rounded-xl bg-[var(--ink)] px-4 py-2 font-bold text-white sm:col-span-3">Find or create customer</button>
      {message && <p className="text-sm text-[var(--danger)] sm:col-span-3">{message}</p>}
    </form>
  );
}
