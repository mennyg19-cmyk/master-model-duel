"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  formatCents,
  isSoldOut,
  type CatalogProductCard,
} from "@/lib/storefront/catalog-shared";

export function CatalogBrowser({
  products,
  categories,
  storeOpen,
  basePath = "/catalog",
  archiveMode = false,
}: {
  products: CatalogProductCard[];
  categories: string[];
  storeOpen: boolean;
  basePath?: string;
  archiveMode?: boolean;
}) {
  const [category, setCategory] = useState<string>("");
  const [sort, setSort] = useState<"price-asc" | "price-desc" | "name">("name");
  const [quickViewId, setQuickViewId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let rows = products;
    if (category) rows = rows.filter((p) => p.category === category);
    const sorted = [...rows];
    if (sort === "price-asc") sorted.sort((a, b) => a.basePriceCents - b.basePriceCents);
    else if (sort === "price-desc") sorted.sort((a, b) => b.basePriceCents - a.basePriceCents);
    else sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [products, category, sort]);

  const quick = filtered.find((p) => p.id === quickViewId) ?? null;
  const canBuy = storeOpen && !archiveMode;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Category</span>
          <select
            className="rounded-[var(--radius-md)] border border-[var(--color-forest)]/20 bg-white px-3 py-2"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            data-testid="catalog-category"
          >
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Sort</span>
          <select
            className="rounded-[var(--radius-md)] border border-[var(--color-forest)]/20 bg-white px-3 py-2"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            data-testid="catalog-sort"
          >
            <option value="name">Name</option>
            <option value="price-asc">Price ↑</option>
            <option value="price-desc">Price ↓</option>
          </select>
        </label>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="catalog-grid">
        {filtered.map((product) => {
          const soldOut = isSoldOut(product);
          return (
            <li
              key={product.id}
              className="flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-forest)]/10 bg-white"
            >
              <div className="aspect-[4/3] bg-[var(--color-cream)]">
                {product.primaryImageUrl || product.mediaAsset?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={product.primaryImageUrl || product.mediaAsset?.url || ""}
                    alt={product.mediaAsset?.altText || product.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-[var(--color-ink)]/40">
                    No photo yet
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-[var(--color-forest)]">{product.name}</h3>
                  <p className="text-sm font-semibold">{formatCents(product.basePriceCents)}</p>
                </div>
                {product.category ? (
                  <p className="text-xs uppercase tracking-wide text-[var(--color-ink)]/50">{product.category}</p>
                ) : null}
                {soldOut ? (
                  <p className="text-sm font-semibold text-[var(--color-danger)]" data-testid="sold-out">
                    Sold out
                  </p>
                ) : null}
                <div className="mt-auto flex flex-wrap gap-2 pt-2">
                  <button
                    type="button"
                    className="rounded-[var(--radius-md)] border border-[var(--color-forest)]/20 px-3 py-1.5 text-sm font-semibold"
                    onClick={() => setQuickViewId(product.id)}
                    data-testid="quick-view"
                  >
                    Quick view
                  </button>
                  <Link
                    href={`${basePath}/${product.slug}`}
                    className="rounded-[var(--radius-md)] bg-[var(--color-leaf)] px-3 py-1.5 text-sm font-semibold text-white"
                  >
                    Details
                  </Link>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {quick ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="qv-title"
          data-testid="quick-view-dialog"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-[var(--radius-lg)] bg-white p-5 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <h2 id="qv-title" className="font-[family-name:var(--font-display)] text-2xl text-[var(--color-forest)]">
                {quick.name}
              </h2>
              <button type="button" className="text-sm font-semibold" onClick={() => setQuickViewId(null)}>
                Close
              </button>
            </div>
            <p className="mt-2 text-sm text-[var(--color-ink)]/80">{quick.description}</p>
            <p className="mt-3 font-semibold">{formatCents(quick.basePriceCents)}</p>
            {quick.options.length ? (
              <ul className="mt-3 space-y-1 text-sm">
                {quick.options.map((opt) => (
                  <li key={opt.id}>
                    {opt.name}: {formatCents(quick.basePriceCents + opt.priceAdjustmentCents)}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={`${basePath}/${quick.slug}`}
                className="rounded-[var(--radius-md)] bg-[var(--color-leaf)] px-3 py-2 text-sm font-semibold text-white"
              >
                Full details
              </Link>
              {canBuy && !isSoldOut(quick) ? (
                <Link
                  href="/order"
                  className="rounded-[var(--radius-md)] border border-[var(--color-forest)]/20 px-3 py-2 text-sm font-semibold"
                >
                  Start order
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
