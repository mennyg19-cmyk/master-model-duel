"use client";

import { useMemo, useState } from "react";
import { formatCents, formatDelta } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { BuilderProduct, CartLine } from "./types";
import { newClientId } from "./draft-reducer";

// R-026: in-builder quick view — the add-to-cart surface. Picks one value per
// option (R-021), restricted add-ons only (the product's allowed list is all
// it can see), quantity, live line price.
export function ProductQuickView({
  product,
  onAdd,
  onClose,
}: {
  product: BuilderProduct;
  onAdd: (line: CartLine) => void;
  onClose: () => void;
}) {
  const [optionValueId, setOptionValueId] = useState<string | null>(
    product.options.length === 1 ? (product.options[0].values[0]?.id ?? null) : null,
  );
  const [addOnIds, setAddOnIds] = useState<string[]>([]);
  const [qty, setQty] = useState(1);

  const selectedDelta = useMemo(() => {
    if (!optionValueId) return 0;
    return (
      product.options.flatMap((option) => option.values).find((value) => value.id === optionValueId)
        ?.priceDeltaCents ?? 0
    );
  }, [product, optionValueId]);

  const addOnTotal = product.addOns
    .filter((addOn) => addOnIds.includes(addOn.id))
    .reduce((sum, addOn) => sum + addOn.priceCents, 0);
  const total = qty * (product.basePriceCents + selectedDelta + addOnTotal);
  const needsOption = product.options.length > 0 && !optionValueId;
  const overStock = product.stock !== null && qty > product.stock && !product.allowBackorder;

  return (
    <Dialog label={`Add ${product.name} to cart`} onClose={onClose} panelClassName="max-w-md">
      <div className="flex items-start justify-between gap-4">
        <div>
          {product.category && (
            <span className="text-xs font-medium uppercase tracking-wide text-stone-500">{product.category}</span>
          )}
          <h2 className="text-xl font-semibold text-stone-900">{product.name}</h2>
        </div>
        <button
          type="button"
          aria-label="Close quick view"
          onClick={onClose}
          className="rounded-md p-1 text-stone-500 hover:bg-stone-100"
        >
          ✕
        </button>
      </div>
      <p className="mt-2 text-sm text-stone-600">
        {product.description ?? "A Tomchei Shabbos package, packed with care."}
      </p>

      {product.options.map((option) => (
        <fieldset key={option.id} className="mt-4">
          <legend className="text-xs font-medium uppercase tracking-wide text-stone-500">{option.name}</legend>
          <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label={option.name}>
            {option.values.map((value) => (
              <button
                key={value.id}
                type="button"
                role="radio"
                aria-checked={optionValueId === value.id}
                onClick={() => setOptionValueId(value.id)}
                className={
                  optionValueId === value.id
                    ? "rounded-full border border-brand-700 bg-brand-700 px-3 py-1 text-sm text-white"
                    : "rounded-full border border-stone-300 bg-white px-3 py-1 text-sm text-stone-700 hover:bg-stone-100"
                }
              >
                {value.label} ({formatDelta(value.priceDeltaCents)})
              </button>
            ))}
          </div>
        </fieldset>
      ))}

      {product.addOns.length > 0 && (
        <fieldset className="mt-4">
          <legend className="text-xs font-medium uppercase tracking-wide text-stone-500">Add-ons</legend>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {product.addOns.map((addOn) => (
              <label key={addOn.id} className="flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={addOnIds.includes(addOn.id)}
                  onChange={(event) =>
                    setAddOnIds((ids) =>
                      event.target.checked ? [...ids, addOn.id] : ids.filter((id) => id !== addOn.id),
                    )
                  }
                  className="h-4 w-4 rounded border-stone-300 text-brand-700 focus:ring-brand-600"
                />
                {addOn.name}
                <span className="text-stone-500">({formatDelta(addOn.priceCents)})</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="mt-4 flex items-center gap-3">
        <label className="text-sm text-stone-600" htmlFor="qv-qty">
          Qty
        </label>
        <div className="flex items-center rounded-md border border-stone-300">
          <button
            type="button"
            aria-label="Decrease quantity"
            onClick={() => setQty((current) => Math.max(1, current - 1))}
            className="px-2.5 py-1 text-stone-600 hover:bg-stone-100"
          >
            −
          </button>
          <span id="qv-qty" className="min-w-8 text-center text-sm font-medium">
            {qty}
          </span>
          <button
            type="button"
            aria-label="Increase quantity"
            onClick={() => setQty((current) => current + 1)}
            className="px-2.5 py-1 text-stone-600 hover:bg-stone-100"
          >
            +
          </button>
        </div>
        {product.stock !== null && (
          <span className="text-xs text-stone-500">
            {product.allowBackorder ? `${product.stock} in stock (backorders allowed)` : `${product.stock} available`}
          </span>
        )}
      </div>
      {overStock && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          Only {product.stock} available — lower the quantity.
        </p>
      )}

      <div className="mt-5 flex items-center gap-2">
        <Button
          className="flex-1"
          disabled={needsOption || overStock}
          onClick={() => {
            onAdd({
              clientId: newClientId(),
              productId: product.id,
              optionValueId,
              qty,
              addOnIds,
              recipientClientId: null,
            });
            onClose();
          }}
        >
          Add to cart · {formatCents(total)}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}
