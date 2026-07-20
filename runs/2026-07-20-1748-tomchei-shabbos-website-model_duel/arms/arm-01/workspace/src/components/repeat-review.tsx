"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/currency";

type RepeatReviewLine = {
  sourceLineId: string;
  sourceProductName: string;
  sourcePriceCents: number;
  quantity: number;
  greeting: string;
  recipientAddressId: string | null;
  recipientName: string;
  mappedProductId: string | null;
  suggestions: {
    id: string;
    name: string;
    priceCents: number;
  }[];
};

export function RepeatReview({
  mode,
  sourceOrder,
  targetSeason,
  addresses,
  lines,
}: {
  mode: "customer" | "staff";
  sourceOrder: {
    id: string;
    version: number;
    customerName: string;
    seasonName: string;
  };
  targetSeason: { name: string };
  addresses: { id: string; recipientName: string; line1: string }[];
  lines: RepeatReviewLine[];
}) {
  const [productChoices, setProductChoices] = useState<Record<string, string>>(
    Object.fromEntries(
      lines.map((line) => [line.sourceLineId, line.mappedProductId ?? ""]),
    ),
  );
  const [recipientChoices, setRecipientChoices] = useState<Record<string, string>>(
    Object.fromEntries(
      lines.map((line) => [line.sourceLineId, line.recipientAddressId ?? ""]),
    ),
  );
  const [hasConfirmedReplacements, setHasConfirmedReplacements] = useState(false);
  const [hasConfirmedRecipients, setHasConfirmedRecipients] = useState(false);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function createDraft() {
    const hasUnresolvedLine = lines.some((line) => {
      const productId = productChoices[line.sourceLineId];
      return !productId || (productId !== "__REMOVE__" && !recipientChoices[line.sourceLineId]);
    });
    if (hasUnresolvedLine) {
      setMessage("Choose a replacement or remove every unavailable gift, then confirm each recipient.");
      return;
    }
    if (!hasConfirmedReplacements || !hasConfirmedRecipients) {
      setMessage("Confirm both replacements and recipients before continuing.");
      return;
    }
    setIsSubmitting(true);
    const response = await fetch(
      mode === "staff"
        ? `/api/admin/orders/${sourceOrder.id}/repeat`
        : "/api/order/repeat",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(mode === "customer" ? { sourceOrderId: sourceOrder.id } : {}),
          sourceVersion: sourceOrder.version,
          decisions: lines.map((line) => ({
            sourceLineId: line.sourceLineId,
            productId:
              productChoices[line.sourceLineId] === "__REMOVE__"
                ? null
                : productChoices[line.sourceLineId],
            recipientAddressId:
              recipientChoices[line.sourceLineId] ||
              addresses[0]?.id ||
              "",
          })),
        }),
      },
    );
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error ?? "The repeated draft could not be created.");
      setIsSubmitting(false);
      return;
    }
    window.location.assign(
      mode === "staff"
        ? `/admin/orders/${payload.draftId}`
        : `/order?draft=${payload.draftId}`,
    );
  }

  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
        Repeat order review
      </p>
      <h1 className="mt-2 text-4xl font-black">
        Review {sourceOrder.seasonName} for {targetSeason.name}
      </h1>
      <p className="mt-3 text-[var(--muted)]">
        Confirm every replacement and recipient for {sourceOrder.customerName}.
        Prices shown are from the new catalog.
      </p>
      <div className="mt-8 space-y-4">
        {lines.map((line) => (
          <article
            className="rounded-3xl border border-[var(--border)] bg-white p-6"
            key={line.sourceLineId}
          >
            <div className="flex flex-wrap justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">
                  {line.quantity} × {line.sourceProductName}
                </h2>
                <p className="text-sm text-[var(--muted)]">
                  Prior price {formatCurrency(line.sourcePriceCents)} · Prior recipient{" "}
                  {line.recipientName}
                </p>
              </div>
              <span
                className={`h-fit rounded-full px-3 py-1 text-xs font-bold ${
                  line.mappedProductId
                    ? "bg-emerald-100 text-emerald-900"
                    : "bg-amber-100 text-amber-950"
                }`}
              >
                {line.mappedProductId
                  ? "Mapped replacement selected"
                  : "Replacement required"}
              </span>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold">
                Replacement
                <select
                  className="rounded-xl border border-[var(--border)] px-3 py-2.5"
                  onChange={(event) =>
                    setProductChoices((current) => ({
                      ...current,
                      [line.sourceLineId]: event.target.value,
                    }))
                  }
                  value={productChoices[line.sourceLineId]}
                >
                  <option value="">Choose a current item</option>
                  {line.suggestions.map((product, index) => (
                    <option key={product.id} value={product.id}>
                      {product.name} · {formatCurrency(product.priceCents)}
                      {index === 0 ? " · closest price" : ""}
                    </option>
                  ))}
                  <option value="__REMOVE__">Remove this gift</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm font-bold">
                Recipient
                <select
                  className="rounded-xl border border-[var(--border)] px-3 py-2.5"
                  disabled={productChoices[line.sourceLineId] === "__REMOVE__"}
                  onChange={(event) =>
                    setRecipientChoices((current) => ({
                      ...current,
                      [line.sourceLineId]: event.target.value,
                    }))
                  }
                  value={recipientChoices[line.sourceLineId]}
                >
                  <option value="">Choose a saved recipient</option>
                  {addresses.map((address) => (
                    <option key={address.id} value={address.id}>
                      {address.recipientName} · {address.line1}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-4 text-sm">
              Greeting: {line.greeting || "No greeting saved"}
            </p>
          </article>
        ))}
      </div>
      <div className="mt-7 space-y-3 rounded-3xl border border-[var(--border)] bg-white p-6">
        <label className="flex gap-3 font-semibold">
          <input
            checked={hasConfirmedReplacements}
            onChange={(event) => setHasConfirmedReplacements(event.target.checked)}
            type="checkbox"
          />
          I reviewed every replacement and removal.
        </label>
        <label className="flex gap-3 font-semibold">
          <input
            checked={hasConfirmedRecipients}
            onChange={(event) => setHasConfirmedRecipients(event.target.checked)}
            type="checkbox"
          />
          I confirmed every recipient and saved address.
        </label>
        <button
          className="mt-3 rounded-full bg-[var(--ink)] px-6 py-3 font-bold text-white disabled:opacity-50"
          disabled={isSubmitting}
          onClick={() => void createDraft()}
          type="button"
        >
          {isSubmitting ? "Creating draft…" : "Create reviewed draft"}
        </button>
        {message && (
          <p aria-live="polite" className="text-sm font-semibold text-[var(--danger)]">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
