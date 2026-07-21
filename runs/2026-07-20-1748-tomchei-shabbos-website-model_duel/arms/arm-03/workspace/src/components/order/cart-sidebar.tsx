"use client";

import { formatCents } from "@/lib/storefront/catalog-shared";

export type DraftLine = {
  id: string;
  productName: string;
  productSku: string;
  quantity: number;
  lineTotalCents: number;
  assigned: boolean;
  recipientName: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

export type DraftState = {
  id: string;
  draftRef: string;
  subtotalCents: number;
  lineCount: number;
  unassignedCount: number;
  isGuest: boolean;
  lines: DraftLine[];
};

export function CartSidebar({
  draft,
  onAssign,
  onRefresh,
  checkoutMode = "storefront",
}: {
  draft: DraftState | null;
  onAssign: (lineId: string) => void;
  onRefresh: (draft: DraftState) => void;
  checkoutMode?: "storefront" | "pos";
}) {
  async function updateQty(lineId: string, quantity: number) {
    if (!draft) return;
    const res = await fetch(`/api/drafts/${draft.draftRef}/lines/${lineId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quantity }),
    });
    const json = await res.json();
    if (json.ok) onRefresh(json.draft);
  }

  async function removeLine(lineId: string) {
    if (!draft) return;
    const res = await fetch(`/api/drafts/${draft.draftRef}/lines/${lineId}`, {
      method: "DELETE",
    });
    const json = await res.json();
    if (json.ok) onRefresh(json.draft);
  }

  if (!draft || draft.lines.length === 0) {
    return (
      <div
        className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-forest)]/20 bg-white p-4 text-sm text-[var(--color-ink)]/60"
        data-testid="cart-empty"
      >
        Cart is empty. Add products to get started.
      </div>
    );
  }

  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--color-forest)]/10 bg-white p-4 shadow-sm"
      data-testid="cart-panel"
    >
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-semibold text-[var(--color-forest)]">Cart</h2>
        <p className="text-sm font-semibold" data-testid="cart-subtotal">
          {formatCents(draft.subtotalCents)}
        </p>
      </div>
      <p className="mb-3 text-xs text-[var(--color-ink)]/60" data-testid="draft-ref">
        Draft {draft.draftRef}
        {draft.isGuest ? " · guest" : ""}
      </p>
      <ul className="space-y-3" data-testid="cart-lines">
        {draft.lines.map((line) => (
          <li
            key={line.id}
            className="rounded-[var(--radius-md)] border border-[var(--color-forest)]/10 p-3"
            data-testid={`cart-line-${line.id}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{line.productName}</p>
                <p className="text-xs text-[var(--color-ink)]/60">
                  Qty {line.quantity} · {formatCents(line.lineTotalCents)}
                </p>
              </div>
              <button
                type="button"
                className="text-xs text-red-700"
                onClick={() => removeLine(line.id)}
              >
                Remove
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={line.quantity}
                onChange={(e) => updateQty(line.id, Number(e.target.value) || 1)}
                className="w-16 rounded border px-2 py-1 text-sm"
                data-testid={`qty-${line.id}`}
              />
              <button
                type="button"
                className="rounded-[var(--radius-md)] bg-[var(--color-forest)] px-2 py-1 text-xs font-semibold text-white"
                onClick={() => onAssign(line.id)}
                data-testid={`assign-${line.id}`}
              >
                {line.assigned ? "Reassign" : "Assign recipient"}
              </button>
            </div>
            {line.assigned ? (
              <p className="mt-2 text-xs text-[var(--color-leaf)]" data-testid={`assigned-${line.id}`}>
                → {line.recipientName}
                {line.city ? `, ${line.city} ${line.state} ${line.postalCode}` : ""}
              </p>
            ) : (
              <p className="mt-2 text-xs text-amber-700">Needs recipient</p>
            )}
          </li>
        ))}
      </ul>
      {draft.unassignedCount > 0 ? (
        <p className="mt-3 text-xs text-amber-800" data-testid="unassigned-count">
          {draft.unassignedCount} line(s) still need a recipient.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-[var(--color-leaf)]" data-testid="all-assigned">
            All lines assigned.
          </p>
          <a
            href={`/checkout?draft=${encodeURIComponent(draft.draftRef)}${checkoutMode === "pos" ? "&mode=pos" : ""}`}
            className="inline-flex w-full items-center justify-center rounded bg-[var(--color-leaf)] px-3 py-2 text-sm font-semibold text-white"
            data-testid="go-checkout"
          >
            Continue to checkout
          </a>
        </div>
      )}
    </div>
  );
}
