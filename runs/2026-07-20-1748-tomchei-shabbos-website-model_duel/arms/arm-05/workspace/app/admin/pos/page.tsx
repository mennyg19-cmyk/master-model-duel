"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { formatMoney } from "@/lib/foundation";

type Product = { id: string; name: string; priceCents: number };

export default function PosPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void fetch("/api/admin/operations?view=products")
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => ok ? setProducts(body.products) : setMessage(body.error));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "pos",
        input: {
          firstName: form.get("firstName"),
          lastName: form.get("lastName"),
          email: form.get("email") || undefined,
          productId: form.get("productId"),
          quantity: Number(form.get("quantity")),
          method: form.get("method"),
        },
      }),
    });
    const body = await response.json();
    setMessage(response.ok ? `${body.payment.method} payment posted for ${formatMoney(body.payment.amountCents)}.` : body.error);
    if (response.ok) event.currentTarget.reset();
  }

  return (
    <>
      <p className="eyebrow">Point of sale</p>
      <h1>Walk-in order</h1>
      <p className="lead">This uses the same server-side cart pricing, inventory reservation, order finalization, and audited cash/check payment path as checkout.</p>
      <form className="card" onSubmit={submit}>
        <div className="address-fields">
          <label>First name<input name="firstName" required /></label>
          <label>Last name<input name="lastName" required /></label>
        </div>
        <label>Email (optional)<input name="email" type="email" /></label>
        <label>Gift<select name="productId" required><option value="">Select a gift</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {formatMoney(product.priceCents)}</option>)}</select></label>
        <label>Quantity<input defaultValue="1" max="100" min="1" name="quantity" required type="number" /></label>
        <label>Payment<select defaultValue="CASH" name="method"><option value="CASH">Cash</option><option value="CHECK">Check</option></select></label>
        <button className="button" type="submit">Post walk-in payment</button>
      </form>
      <p><Link href="/admin/operations">Back to operations</Link></p>
      {message && <p className="notice" role="status">{message}</p>}
    </>
  );
}
