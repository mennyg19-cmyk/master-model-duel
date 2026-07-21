"use client";

import { useMemo, useState } from "react";
import { formatCents } from "@/lib/storefront/catalog-shared";

export type BuilderProduct = {
  id: string;
  name: string;
  slug: string;
  sku: string;
  category: string | null;
  description: string | null;
  basePriceCents: number;
  tracksInventory: boolean;
  primaryImageUrl: string | null;
  stockAvailable: number | null;
  options: Array<{ id: string; name: string; priceAdjustmentCents: number }>;
  allowedAddOns: Array<{
    id: string;
    name: string;
    sku: string;
    priceCents: number;
    isRestricted: boolean;
  }>;
};

export function ProductPanel({
  products,
  onAdd,
}: {
  products: BuilderProduct[];
  onAdd: (
    product: BuilderProduct,
    opts: { optionId?: string | null; addOnIds: string[]; quantity: number },
  ) => Promise<void>;
}) {
  const [quickViewId, setQuickViewId] = useState<string | null>(null);
  const [optionId, setOptionId] = useState<string>("");
  const [addOnIds, setAddOnIds] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);

  const quick = useMemo(
    () => products.find((p) => p.id === quickViewId) ?? null,
    [products, quickViewId],
  );

  async function handleAdd(product: BuilderProduct) {
    setBusy(true);
    try {
      await onAdd(product, {
        optionId: optionId || product.options[0]?.id || null,
        addOnIds,
        quantity: qty,
      });
      setQuickViewId(null);
      setAddOnIds([]);
      setQty(1);
      setOptionId("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="builder-product-panel">
      <ul className="grid gap-4 sm:grid-cols-2" data-testid="builder-product-grid">
        {products.map((product) => {
          const soldOut =
            product.stockAvailable !== null && product.stockAvailable <= 0;
          return (
            <li
              key={product.id}
              className="flex flex-col rounded-[var(--radius-lg)] border border-[var(--color-forest)]/10 bg-white p-4"
              data-testid={`builder-card-${product.sku}`}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-[var(--color-forest)]">{product.name}</h3>
                <p className="text-sm font-semibold">{formatCents(product.basePriceCents)}</p>
              </div>
              <p className="mt-1 text-xs text-[var(--color-ink)]/60">
                {product.stockAvailable === null
                  ? "In stock"
                  : soldOut
                    ? "Sold out"
                    : `${product.stockAvailable} available`}
              </p>
              <div className="mt-auto flex gap-2 pt-4">
                <button
                  type="button"
                  className="rounded-[var(--radius-md)] border border-[var(--color-forest)]/20 px-3 py-1.5 text-sm font-semibold"
                  onClick={() => {
                    setQuickViewId(product.id);
                    setOptionId(product.options[0]?.id ?? "");
                    setAddOnIds([]);
                    setQty(1);
                  }}
                  data-testid={`quick-view-${product.sku}`}
                >
                  Quick view
                </button>
                <button
                  type="button"
                  disabled={soldOut || busy}
                  className="rounded-[var(--radius-md)] bg-[var(--color-leaf)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                  onClick={() => handleAdd(product)}
                  data-testid={`add-${product.sku}`}
                >
                  Add
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {quick ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          data-testid="builder-quick-view"
          onClick={() => setQuickViewId(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-auto rounded-[var(--radius-lg)] bg-white p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-[family-name:var(--font-display)] text-2xl text-[var(--color-forest)]">
              {quick.name}
            </h3>
            <p className="mt-2 text-sm text-[var(--color-ink)]/70">{quick.description}</p>
            <p className="mt-2 text-sm font-semibold">
              Live stock:{" "}
              {quick.stockAvailable === null ? "unlimited" : quick.stockAvailable}
            </p>

            {quick.options.length > 0 ? (
              <label className="mt-4 block text-sm">
                <span className="font-semibold">Option</span>
                <select
                  className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--color-forest)]/20 px-3 py-2"
                  value={optionId}
                  onChange={(e) => setOptionId(e.target.value)}
                  data-testid="option-select"
                >
                  {quick.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                      {o.priceAdjustmentCents
                        ? ` (${o.priceAdjustmentCents > 0 ? "+" : ""}${formatCents(o.priceAdjustmentCents)})`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {quick.allowedAddOns.length > 0 ? (
              <fieldset className="mt-4 space-y-2" data-testid="addon-list">
                <legend className="text-sm font-semibold">Add-ons</legend>
                {quick.allowedAddOns.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={addOnIds.includes(a.id)}
                      onChange={(e) => {
                        setAddOnIds((prev) =>
                          e.target.checked
                            ? [...prev, a.id]
                            : prev.filter((id) => id !== a.id),
                        );
                      }}
                    />
                    <span>
                      {a.name} ({formatCents(a.priceCents)})
                      {a.isRestricted ? (
                        <span className="ml-1 text-xs text-amber-700">restricted</span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : null}

            <label className="mt-4 block text-sm">
              <span className="font-semibold">Quantity</span>
              <input
                type="number"
                min={1}
                max={quick.stockAvailable ?? 99}
                value={qty}
                onChange={(e) => setQty(Number(e.target.value) || 1)}
                className="mt-1 w-24 rounded-[var(--radius-md)] border border-[var(--color-forest)]/20 px-3 py-2"
                data-testid="qty-input"
              />
            </label>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                className="rounded-[var(--radius-md)] border px-3 py-2 text-sm font-semibold"
                onClick={() => setQuickViewId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || (quick.stockAvailable !== null && quick.stockAvailable <= 0)}
                className="rounded-[var(--radius-md)] bg-[var(--color-leaf)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
                onClick={() => handleAdd(quick)}
                data-testid="quick-view-add"
              >
                Add to cart
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
