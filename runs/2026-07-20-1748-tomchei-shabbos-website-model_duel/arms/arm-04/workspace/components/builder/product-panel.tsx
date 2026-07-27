"use client";

import { useState } from "react";
import { formatCents } from "@/lib/catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { BuilderProduct, BuilderAddOn } from "@/components/builder/types";

function ProductImage({ product, className }: { product: BuilderProduct; className: string }) {
  if (product.imageUrl) {
    // Plain img: media URLs are dynamic (local driver or Vercel Blob).
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={product.imageUrl} alt={product.name} className={`${className} object-cover`} />;
  }
  return (
    <div className={`${className} flex items-center justify-center bg-brand-soft text-4xl`} aria-hidden>
      🎁
    </div>
  );
}

/**
 * The builder's product panel (R-026): cards with live stock, quick add, and
 * a quick-view dialog where options and add-ons are picked.
 */
export function ProductPanel({
  products,
  addOns,
  onAdd,
}: {
  products: BuilderProduct[];
  addOns: BuilderAddOn[];
  onAdd: (
    product: BuilderProduct,
    config: { quantity: number; optionIds: string[]; addOns: { addOnId: string; quantity: number }[] }
  ) => void;
}) {
  const [quickViewId, setQuickViewId] = useState<string | null>(null);
  const quickViewProduct = products.find((product) => product.id === quickViewId) ?? null;

  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="builder-product-panel">
        {products.map((product) => (
          <li
            key={product.id}
            className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm"
          >
            <ProductImage product={product} className="h-36 w-full" />
            <div className="flex flex-1 flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{product.name}</h3>
                <p className="font-semibold text-brand-strong">{formatCents(product.basePriceCents)}</p>
              </div>
              {product.available !== null && (
                <p className="mt-0.5 text-xs text-muted" data-testid={`stock-${product.slug}`}>
                  {product.soldOut ? "Out of stock" : `${product.available} in stock`}
                </p>
              )}
              <div className="mt-auto flex items-center gap-2 pt-3">
                {product.soldOut && <Badge tone="danger">Sold out</Badge>}
                <button
                  type="button"
                  onClick={() => setQuickViewId(product.id)}
                  className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-brand-soft"
                >
                  {product.options.length > 0 ? "Customize" : "Quick view"}
                </button>
                <Button
                  className="ml-auto"
                  disabled={product.soldOut}
                  onClick={() => onAdd(product, { quantity: 1, optionIds: [], addOns: [] })}
                >
                  Add
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {quickViewProduct && (
        <QuickViewDialog
          product={quickViewProduct}
          addOns={addOns.filter(
            (addOn) =>
              addOn.restrictedToProductIds.length === 0 ||
              addOn.restrictedToProductIds.includes(quickViewProduct.id)
          )}
          onClose={() => setQuickViewId(null)}
          onAdd={(config) => {
            onAdd(quickViewProduct, config);
            setQuickViewId(null);
          }}
        />
      )}
    </>
  );
}

function QuickViewDialog({
  product,
  addOns,
  onClose,
  onAdd,
}: {
  product: BuilderProduct;
  addOns: BuilderAddOn[];
  onClose: () => void;
  onAdd: (config: {
    quantity: number;
    optionIds: string[];
    addOns: { addOnId: string; quantity: number }[];
  }) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [optionIds, setOptionIds] = useState<string[]>([]);
  const [addOnIds, setAddOnIds] = useState<string[]>([]);

  const unitCents =
    product.basePriceCents +
    product.options
      .filter((option) => optionIds.includes(option.id))
      .reduce((sum, option) => sum + option.priceAdjustmentCents, 0) +
    addOns.filter((addOn) => addOnIds.includes(addOn.id)).reduce((sum, addOn) => sum + addOn.priceCents, 0);

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
  }

  return (
    <Modal title={product.name} onClose={onClose}>
      <ProductImage product={product} className="h-44 w-full rounded-md" />
      <p className="mt-3 text-sm text-muted">{product.description ?? "No description yet."}</p>
      {product.available !== null && (
        <p className="mt-1 text-xs text-muted">
          {product.soldOut ? "Out of stock" : `${product.available} in stock`}
        </p>
      )}

      {product.options.length > 0 && (
        <fieldset className="mt-4">
          <legend className="text-sm font-semibold">Options</legend>
          {product.options.map((option) => (
            <label key={option.id} className="mt-1 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={optionIds.includes(option.id)}
                onChange={() => setOptionIds((current) => toggle(current, option.id))}
              />
              {option.name} (+{formatCents(option.priceAdjustmentCents)})
            </label>
          ))}
        </fieldset>
      )}

      {addOns.length > 0 && (
        <fieldset className="mt-4">
          <legend className="text-sm font-semibold">Add-ons</legend>
          {addOns.map((addOn) => (
            <label key={addOn.id} className="mt-1 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={addOnIds.includes(addOn.id)}
                onChange={() => setAddOnIds((current) => toggle(current, addOn.id))}
                disabled={addOn.available !== null && addOn.available <= 0}
              />
              {addOn.name} (+{formatCents(addOn.priceCents)})
              {addOn.available !== null && addOn.available <= 0 && (
                <span className="text-xs text-danger">out of stock</span>
              )}
            </label>
          ))}
        </fieldset>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          Qty
          <input
            type="number"
            min={1}
            max={product.available ?? 999}
            value={quantity}
            onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
            className="w-16 rounded-md border border-border px-2 py-1 text-sm"
          />
        </label>
        <Button
          disabled={product.soldOut}
          onClick={() =>
            onAdd({
              quantity,
              optionIds,
              addOns: addOnIds.map((addOnId) => ({ addOnId, quantity: 1 })),
            })
          }
        >
          Add {quantity > 1 ? `${quantity} ` : ""}to cart — {formatCents(unitCents * quantity)}
        </Button>
      </div>
    </Modal>
  );
}
