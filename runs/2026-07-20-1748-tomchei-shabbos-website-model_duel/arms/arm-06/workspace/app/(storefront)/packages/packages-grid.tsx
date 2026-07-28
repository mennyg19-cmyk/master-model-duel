"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatDelta } from "@/lib/money";
import { lowestPriceCents, priceLabel } from "@/lib/storefront/pricing";
import { ProductImage } from "@/components/product-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/filter-chip";

export interface GridProduct {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  basePriceCents: number;
  soldOut: boolean;
  stock: number | null;
  imageUrl: string | null;
  options: { name: string; values: { label: string; priceDeltaCents: number }[] }[];
}

type SortKey = "name" | "price-asc" | "price-desc";

// R-006/015/016/017: category filters, price sort, sold-out handling, and the
// quick-view dialog — one grid component so all three controls share state.
export function PackagesGrid({ products, categories }: { products: GridProduct[]; categories: string[] }) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [quickViewSlug, setQuickViewSlug] = useState<string | null>(null);

  const visibleProducts = useMemo(() => {
    const filtered = activeCategory
      ? products.filter((product) => product.category === activeCategory)
      : products;
    const sorted = [...filtered];
    if (sortKey === "price-asc") sorted.sort((a, b) => lowestPriceCents(a) - lowestPriceCents(b));
    if (sortKey === "price-desc") sorted.sort((a, b) => lowestPriceCents(b) - lowestPriceCents(a));
    if (sortKey === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [products, activeCategory, sortKey]);

  const quickViewProduct = products.find((product) => product.slug === quickViewSlug) ?? null;
  const closeQuickView = useCallback(() => setQuickViewSlug(null), []);

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
          <FilterChip label="All" isActive={activeCategory === null} onClick={() => setActiveCategory(null)} />
          {categories.map((category) => (
            <FilterChip
              key={category}
              label={category}
              isActive={activeCategory === category}
              onClick={() => setActiveCategory(category)}
            />
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          Sort
          <select
            aria-label="Sort products"
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as SortKey)}
            className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
          >
            <option value="name">Name</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
          </select>
        </label>
      </div>

      {visibleProducts.length === 0 ? (
        <p className="mt-10 text-sm text-stone-500">No packages in this category yet.</p>
      ) : (
        <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {visibleProducts.map((product) => (
            <li
              key={product.id}
              className={cn(
                "flex flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm",
                product.soldOut && "opacity-75",
              )}
            >
              <div className="relative flex h-44 items-center justify-center bg-brand-50 text-brand-200">
                <ProductImage
                  src={product.imageUrl}
                  alt={product.name}
                  className="h-full w-full object-cover"
                  glyphSize={56}
                />
                {product.soldOut && (
                  <Badge tone="red" className="absolute left-3 top-3">
                    Sold out
                  </Badge>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                {product.category && <span className="text-xs font-medium uppercase tracking-wide text-stone-500">{product.category}</span>}
                <h2 className="text-lg font-semibold text-stone-900">
                  <Link href={`/packages/${product.slug}`} className="hover:text-brand-700">
                    {product.name}
                  </Link>
                </h2>
                <p className="text-sm font-medium text-brand-700">{priceLabel(product)}</p>
                {product.stock !== null && !product.soldOut && product.stock <= 10 && (
                  <p className="text-xs text-amber-700">Only {product.stock} left</p>
                )}
                <div className="mt-auto flex gap-2 pt-2">
                  <Button size="sm" variant="secondary" onClick={() => setQuickViewSlug(product.slug)}>
                    Quick view
                  </Button>
                  <Link href={`/packages/${product.slug}`} className="ml-auto">
                    <Button size="sm" variant={product.soldOut ? "secondary" : "primary"} disabled={product.soldOut}>
                      {product.soldOut ? "Sold out" : "View"}
                    </Button>
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {quickViewProduct && <QuickViewDialog product={quickViewProduct} onClose={closeQuickView} />}
    </div>
  );
}

// Modal behavior for the quick view: focus moves inside on open, Escape
// closes, and Tab cycles within the panel.
function QuickViewDialog({ product, onClose }: { product: GridProduct; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.querySelector<HTMLElement>("button, a")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Quick view: ${product.name}`}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            {product.category && (
              <span className="text-xs font-medium uppercase tracking-wide text-stone-500">
                {product.category}
              </span>
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
        {product.soldOut && (
          <Badge tone="red" className="mt-2">
            Sold out
          </Badge>
        )}
        <p className="mt-3 text-sm text-stone-600">
          {product.description ?? "A Tomchei Shabbos package, packed with care."}
        </p>
        {product.options.length > 0 && (
          <dl className="mt-4 flex flex-col gap-2">
            {product.options.map((option) => (
              <div key={option.name}>
                <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">{option.name}</dt>
                <dd className="mt-1 flex flex-wrap gap-2">
                  {option.values.map((value) => (
                    <span key={value.label} className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-700">
                      {value.label} ({formatDelta(value.priceDeltaCents)})
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-4 text-lg font-semibold text-brand-700">{priceLabel(product)}</p>
        <div className="mt-4 flex gap-2">
          <Link href={`/packages/${product.slug}`} className="flex-1">
            <Button className="w-full" disabled={product.soldOut}>
              {product.soldOut ? "Sold out" : "Open details"}
            </Button>
          </Link>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
