"use client";

import Image from "next/image";
import type { BuilderProduct } from "@/components/order-builder";
import { formatCurrency } from "@/lib/currency";

export function BuilderProductCard({
  product,
  onAdd,
  onQuickView,
}: {
  product: BuilderProduct;
  onAdd: () => void;
  onQuickView: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-[2rem] border border-[var(--border)] bg-white">
      <div className="relative grid aspect-[4/3] place-items-center bg-[var(--brand-soft)]">
        <Image
          alt=""
          className="h-3/4 w-3/4 object-contain"
          height={320}
          src={product.imageUrl ?? "/purim-ribbon.svg"}
          width={420}
        />
        <button
          className="absolute bottom-4 rounded-full bg-white px-4 py-2 text-sm font-bold shadow"
          onClick={onQuickView}
          type="button"
        >
          Quick view
        </button>
      </div>
      <div className="p-6">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--brand)]">
          {product.category}
        </p>
        <div className="mt-2 flex justify-between gap-4">
          <h2 className="text-xl font-bold">{product.name}</h2>
          <strong>{formatCurrency(product.priceCents)}</strong>
        </div>
        <p className="mt-3 text-sm text-[var(--muted)]">
          {product.availableQuantity === null
            ? "Available"
            : product.availableQuantity > 0
              ? `${product.availableQuantity} in stock`
              : "Sold out"}
        </p>
        <button
          className="mt-5 w-full rounded-full bg-[var(--brand)] px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-[var(--muted)]"
          disabled={product.availableQuantity === 0}
          onClick={onAdd}
          type="button"
        >
          Add to cart
        </button>
      </div>
    </article>
  );
}

export function ProductQuickView({
  product,
  onAdd,
  onClose,
}: {
  product: BuilderProduct;
  onAdd: () => void;
  onClose: () => void;
}) {
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--ink)]/60 p-5"
      role="dialog"
    >
      <div className="max-w-lg rounded-[2rem] bg-white p-8">
        <button className="float-right text-2xl" onClick={onClose} type="button">
          ×
        </button>
        <h2 className="text-3xl font-black">{product.name}</h2>
        <p className="mt-3 leading-7 text-[var(--muted)]">{product.description}</p>
        <button
          className="mt-6 rounded-full bg-[var(--brand)] px-6 py-3 font-bold text-white"
          onClick={onAdd}
          type="button"
        >
          Add to cart
        </button>
      </div>
    </div>
  );
}
