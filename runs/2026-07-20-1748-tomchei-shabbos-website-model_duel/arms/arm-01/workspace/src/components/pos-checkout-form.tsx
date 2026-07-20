"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/currency";

type PosLine = {
  id: string;
  productName: string;
  recipientName: string;
  rememberedGreeting: string;
};

export function PosCheckoutForm({
  orderId,
  lines,
  fulfillmentMethods,
  deliveryDays,
  subtotalCents,
}: {
  orderId: string;
  lines: PosLine[];
  fulfillmentMethods: { code: string; displayName: string }[];
  deliveryDays: string[];
  subtotalCents: number;
}) {
  const [message, setMessage] = useState("");
  async function checkout(formData: FormData) {
    const response = await fetch(`/api/admin/pos/orders/${orderId}/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        method: formData.get("paymentMethod"),
        reference: formData.get("reference"),
        choices: lines.map((line) => {
          const fulfillmentCode = String(formData.get(`fulfillment-${line.id}`));
          return {
            orderLineId: line.id,
            fulfillmentCode,
            greeting: formData.get(`greeting-${line.id}`),
            deliveryDay:
              fulfillmentCode === "PICKUP"
                ? null
                : formData.get(`delivery-day-${line.id}`),
          };
        }),
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error);
      return;
    }
    window.location.assign(`/admin/orders/${orderId}`);
  }
  return (
    <form action={checkout} className="space-y-5">
      {lines.map((line) => (
        <fieldset className="rounded-2xl border border-[var(--border)] p-4" key={line.id}>
          <legend className="px-2 font-bold">{line.productName} · {line.recipientName}</legend>
          <label className="mt-2 block text-sm font-bold">Fulfillment
            <select className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2" name={`fulfillment-${line.id}`}>
              {fulfillmentMethods.map((method) => <option key={method.code} value={method.code}>{method.displayName}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-sm font-bold">Greeting
            <input className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2" defaultValue={line.rememberedGreeting || "A freilichen Purim!"} name={`greeting-${line.id}`} required />
          </label>
          <label className="mt-3 block text-sm font-bold">Delivery day
            <select className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2" defaultValue={deliveryDays[0]} name={`delivery-day-${line.id}`}>
              {deliveryDays.map((day) => <option key={day} value={day}>{day}</option>)}
            </select>
            <span className="mt-1 block font-normal text-[var(--muted)]">Ignored for pickup.</span>
          </label>
        </fieldset>
      ))}
      <div className="rounded-2xl bg-[var(--surface)] p-5">
        <p className="flex justify-between text-lg font-black"><span>Starting subtotal</span><span>{formatCurrency(subtotalCents)}</span></p>
        <p className="mt-1 text-sm text-[var(--muted)]">Final total includes the selected fulfillment fees.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <select className="rounded-xl border border-[var(--border)] px-3 py-2" name="paymentMethod"><option value="CASH">Cash</option><option value="CHECK">Check</option></select>
          <input className="rounded-xl border border-[var(--border)] px-3 py-2" name="reference" placeholder="Receipt or check number" required />
        </div>
        <button className="mt-4 w-full rounded-xl bg-[var(--ink)] px-5 py-3 font-bold text-white">Finalize and post payment</button>
      </div>
      {message && <p aria-live="polite" className="rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-900">{message}</p>}
    </form>
  );
}
