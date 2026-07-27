"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/foundation";

type Address = { id: string; recipientName: string; line1: string; city: string; state: string; postalCode: string; greetingPreference?: string | null };
type Draft = {
  id: string;
  totalCents: number;
  donationCents: number;
  fulfillmentCents: number;
  addresses: Address[];
  wireFormat: { lines?: { recipient?: { addressId?: string } }[] };
};
type RecipientChoice = { addressId: string; method: "SHIP" | "PICKUP" | "BULK_DELIVERY" | "LOCAL_DELIVERY"; greeting: string };
const storageKey = "tomchei-order-draft";

export function CheckoutFlow() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [choices, setChoices] = useState<RecipientChoice[]>([]);
  const [donationCents, setDonationCents] = useState(0);
  const [message, setMessage] = useState(() => typeof window !== "undefined" && !sessionStorage.getItem(storageKey)
    ? "Your saved draft is not available on this device."
    : "Loading your saved draft…");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem(storageKey);
    if (!stored) return;
    const { id, token } = JSON.parse(stored) as { id: string; token?: string };
    void fetch(`/api/order/drafts/${id}`, { headers: token ? { "x-draft-access-token": token } : {} })
      .then(async (response) => ({ response, body: await response.json() as { draft?: Draft; error?: string } }))
      .then(({ response, body }) => {
        if (!response.ok || !body.draft) {
          setMessage(body.error ?? "Your saved draft is no longer available.");
          return;
        }
        const addressIds = new Set(body.draft.wireFormat.lines?.map((line) => line.recipient?.addressId).filter(Boolean));
        const recipients = body.draft.addresses.filter((address) => addressIds.has(address.id));
        setDraft(body.draft);
        setChoices(recipients.map((address) => ({
          addressId: address.id,
          method: "LOCAL_DELIVERY",
          greeting: address.greetingPreference ?? "Happy Purim!",
        })));
        setMessage("");
      });
  }, []);

  const estimatedTotal = useMemo(() => draft ? draft.totalCents + donationCents : 0, [draft, donationCents]);

  function updateChoice(addressId: string, patch: Partial<RecipientChoice>) {
    setChoices((currentChoices) => currentChoices.map((choice) => choice.addressId === addressId ? { ...choice, ...patch } : choice));
  }

  async function beginCheckout() {
    if (!draft) return;
    const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}") as { token?: string };
    setIsSubmitting(true);
    const response = await fetch(`/api/checkout/${draft.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: window.location.origin, ...(stored.token ? { "x-draft-access-token": stored.token } : {}) },
      body: JSON.stringify({ recipients: choices, donationCents }),
    });
    const body = await response.json() as { url?: string; error?: string };
    if (!response.ok || !body.url) {
      setMessage(body.error ?? "Checkout could not start.");
      setIsSubmitting(false);
      return;
    }
    window.location.assign(body.url);
  }

  if (!draft) return <main><h1>Checkout</h1><p role="status">{message}</p></main>;
  return (
    <main className="order-layout">
      <section>
        <p className="eyebrow">Checkout</p>
        <h1>Choose delivery and write each greeting.</h1>
        {choices.map((choice) => {
          const address = draft.addresses.find((candidate) => candidate.id === choice.addressId);
          if (!address) return null;
          return <section className="card order-line" key={address.id}>
            <h2>{address.recipientName}</h2>
            <p>{address.line1}, {address.city}, {address.state} {address.postalCode}</p>
            <label>Fulfillment method
              <select onChange={(event) => updateChoice(address.id, { method: event.target.value as RecipientChoice["method"] })} value={choice.method}>
                <option value="LOCAL_DELIVERY">Per-package local delivery</option>
                <option value="BULK_DELIVERY">Bulk delivery</option>
                <option value="SHIP">Ship later</option>
                <option value="PICKUP">Pick up</option>
              </select>
            </label>
            <label>Greeting
              <textarea onChange={(event) => updateChoice(address.id, { greeting: event.target.value })} value={choice.greeting} />
            </label>
          </section>;
        })}
      </section>
      <aside className="cart-sidebar">
        <p className="eyebrow">Order summary</p>
        <p>Delivery fees are calculated when checkout begins. Live carrier rates arrive in the shipping phase.</p>
        <label>Optional donation
          <input min="0" onChange={(event) => setDonationCents(Math.round(Number(event.target.value || 0) * 100))} step="1" type="number" value={donationCents / 100} />
        </label>
        <strong className="cart-total">{formatMoney(estimatedTotal)}</strong>
        <button className="button" disabled={isSubmitting || choices.length === 0} onClick={() => void beginCheckout()} type="button">
          {isSubmitting ? "Starting secure checkout…" : "Continue to secure checkout"}
        </button>
        {message && <p role="status">{message}</p>}
      </aside>
    </main>
  );
}
