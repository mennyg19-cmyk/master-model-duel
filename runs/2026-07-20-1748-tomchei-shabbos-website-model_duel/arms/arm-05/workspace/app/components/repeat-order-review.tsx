"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/foundation";
import type { RepeatLine } from "@/lib/repeat-orders";

type Address = { id: string; recipientName: string; line1: string; city: string; state: string; postalCode: string };
type Review = { lines: RepeatLine[]; addresses: Address[] };

export function RepeatOrderReview({ draftId }: { draftId: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [selections, setSelections] = useState<Record<string, { productId?: string; addressId?: string; greeting: string }>>({});
  const [message, setMessage] = useState("Loading your repeat order…");

  useEffect(() => {
    void fetch(`/api/repeat/${draftId}`).then(async (response) => {
      const body = await response.json() as Review & { error?: string };
      if (!response.ok) return setMessage(body.error ?? "Unable to load the repeat order.");
      setReview(body);
      setSelections(Object.fromEntries(body.lines.map((line) => [line.sourceLineId, {
        productId: line.suggestedProductId,
        addressId: body.addresses.some((address) => address.id === line.recipient.addressId) ? line.recipient.addressId : undefined,
        greeting: line.recipient.greeting,
      }])));
      setMessage("");
    });
  }, [draftId]);

  function updateLine(sourceLineId: string, patch: Partial<{ productId?: string; addressId?: string; greeting: string }>) {
    setSelections((current) => ({ ...current, [sourceLineId]: { ...current[sourceLineId], ...patch } }));
  }

  async function confirm() {
    if (!review) return;
    const response = await fetch(`/api/repeat/${draftId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lines: review.lines.map((line) => ({ sourceLineId: line.sourceLineId, ...selections[line.sourceLineId] })) }),
    });
    const body = await response.json() as { error?: string };
    if (!response.ok) return setMessage(body.error ?? "Unable to confirm the repeat order.");
    window.location.assign("/checkout");
  }

  if (!review) return <p className="notice" role="status">{message}</p>;
  return (
    <main>
      <p className="eyebrow">Repeat your order</p>
      <h1>Confirm gifts and recipients</h1>
      <p className="lead">We suggested the closest-priced mapped item. An unavailable prior item must be replaced or removed before checkout.</p>
      {review.lines.map((line) => {
        const selection = selections[line.sourceLineId] ?? { greeting: "" };
        const hasStaleRecipient = Boolean(line.recipient.addressId && !review.addresses.some((address) => address.id === line.recipient.addressId));
        return (
          <section className="card" key={line.sourceLineId}>
            <h2>{line.sourceName} × {line.quantity}</h2>
            <p>Last year: {formatMoney(line.sourcePriceCents)}</p>
            {line.candidates.length === 0 && <p className="notice">Unmapped item: choose Remove this item or return after a manager maps a replacement.</p>}
            <label>Replacement
              <select onChange={(event) => updateLine(line.sourceLineId, { productId: event.target.value || undefined })} value={selection.productId ?? ""}>
                <option value="">Remove this item</option>
                {line.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {formatMoney(candidate.priceCents)}{candidate.id === line.suggestedProductId ? " (suggested)" : ""}</option>)}
              </select>
            </label>
            {hasStaleRecipient && <p className="notice">This prior recipient address is no longer in your address book. Choose a current recipient.</p>}
            <label>Recipient
              <select onChange={(event) => updateLine(line.sourceLineId, { addressId: event.target.value || undefined })} value={selection.addressId ?? ""}>
                <option value="">Choose a recipient</option>
                {review.addresses.map((address) => <option key={address.id} value={address.id}>{address.recipientName} · {address.line1}, {address.city}</option>)}
              </select>
            </label>
            <label>Greeting<input onChange={(event) => updateLine(line.sourceLineId, { greeting: event.target.value })} value={selection.greeting} /></label>
          </section>
        );
      })}
      <button className="button" onClick={() => void confirm()} type="button">Confirm replacements and recipients</button>
      {message && <p className="notice" role="status">{message}</p>}
    </main>
  );
}
