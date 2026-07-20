"use client";

import { useState } from "react";
import Link from "next/link";
import type { CatalogProduct } from "@/lib/catalog";
import { formatCents } from "@/lib/catalog";
import { Badge } from "@/components/ui/badge";

function ProductImage({ product, className }: { product: CatalogProduct; className: string }) {
  if (product.imageUrl) {
    // Plain img: media URLs are dynamic (local driver or Vercel Blob), so
    // next/image's build-time domain allowlist doesn't fit here.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={product.imageUrl} alt={product.name} className={`${className} object-cover`} />;
  }
  return (
    <div className={`${className} flex items-center justify-center bg-brand-soft text-4xl`} aria-hidden>
      🎁
    </div>
  );
}

/** Catalog grid with the quick-view overlay (R-015). Browse-only when canOrder is false (archive). */
export function ProductGrid({ products, canOrder }: { products: CatalogProduct[]; canOrder: boolean }) {
  const [quickViewId, setQuickViewId] = useState<string | null>(null);
  const quickViewProduct = products.find((product) => product.id === quickViewId) ?? null;

  return (
    <>
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <li key={product.id} className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
            <ProductImage product={product} className="h-44 w-full" />
            <div className="flex flex-1 flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">
                  {canOrder ? (
                    <Link href={`/catalog/${product.slug}`} className="hover:text-brand">
                      {product.name}
                    </Link>
                  ) : (
                    product.name
                  )}
                </h3>
                <p className="font-semibold text-brand-strong">{formatCents(product.basePriceCents)}</p>
              </div>
              {product.category && <p className="mt-0.5 text-xs text-muted">{product.category}</p>}
              <div className="mt-auto flex items-center gap-2 pt-3">
                {product.soldOut && <Badge tone="danger">Sold out</Badge>}
                <button
                  type="button"
                  onClick={() => setQuickViewId(product.id)}
                  className="ml-auto rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-brand-soft"
                >
                  Quick view
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {quickViewProduct && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Quick view: ${quickViewProduct.name}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setQuickViewId(null)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-surface p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold">{quickViewProduct.name}</h3>
              <button
                type="button"
                aria-label="Close quick view"
                onClick={() => setQuickViewId(null)}
                className="rounded p-1 text-muted hover:bg-brand-soft"
              >
                ✕
              </button>
            </div>
            <ProductImage product={quickViewProduct} className="mt-3 h-48 w-full rounded-md" />
            <p className="mt-3 text-sm text-muted">{quickViewProduct.description ?? "No description yet."}</p>
            <p className="mt-2 font-semibold text-brand-strong">
              {formatCents(quickViewProduct.basePriceCents)}
              {quickViewProduct.soldOut && <Badge tone="danger" className="ml-2">Sold out</Badge>}
            </p>
            {quickViewProduct.options.length > 0 && (
              <ul className="mt-2 text-sm text-muted">
                {quickViewProduct.options.map((option) => (
                  <li key={option.id}>
                    + {option.name} ({formatCents(option.priceAdjustmentCents)})
                  </li>
                ))}
              </ul>
            )}
            {canOrder && (
              <Link
                href={`/catalog/${quickViewProduct.slug}`}
                className="mt-4 inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
              >
                View details
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}
