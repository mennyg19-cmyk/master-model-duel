"use client";

import { FilterChip } from "@/components/ui/filter-chip";
import { BuilderProduct } from "./types";
import { ProductCard } from "./product-card";

// R-026: builder product panel — the catalog half of the builder. Category
// chips mirror the storefront grid so the two surfaces feel like one store.
export function ProductPanel({
  products,
  activeCategory,
  onCategory,
  onQuickView,
}: {
  products: BuilderProduct[];
  activeCategory: string | null;
  onCategory: (category: string | null) => void;
  onQuickView: (product: BuilderProduct) => void;
}) {
  const categories = Array.from(
    new Set(products.map((product) => product.category).filter((category): category is string => Boolean(category))),
  ).sort();
  const visible = activeCategory ? products.filter((product) => product.category === activeCategory) : products;

  return (
    <section aria-label="Products">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        <FilterChip label="All" isActive={activeCategory === null} onClick={() => onCategory(null)} />
        {categories.map((category) => (
          <FilterChip
            key={category}
            label={category}
            isActive={activeCategory === category}
            onClick={() => onCategory(category)}
          />
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="mt-10 text-sm text-stone-500">No packages in this category yet.</p>
      ) : (
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((product) => (
            <ProductCard key={product.id} product={product} onQuickView={onQuickView} />
          ))}
        </ul>
      )}
    </section>
  );
}
