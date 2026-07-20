"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { formatCurrency } from "@/lib/currency";

export type CatalogProduct = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  imageUrl: string | null;
  priceCents: number;
  availableQuantity: number | null;
  options: {
    id: string;
    name: string;
    value: string;
    priceAdjustmentCents: number;
  }[];
};

export function CatalogExplorer({
  products,
  isOpen,
}: {
  products: CatalogProduct[];
  isOpen: boolean;
}) {
  const categories = ["All", ...new Set(products.map((product) => product.category))];
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState("featured");
  const [quickViewProduct, setQuickViewProduct] = useState<CatalogProduct | null>(null);

  const visibleProducts = useMemo(() => {
    const filteredProducts =
      category === "All"
        ? products
        : products.filter((product) => product.category === category);
    return [...filteredProducts].sort((left, right) => {
      if (sort === "price-low") return left.priceCents - right.priceCents;
      if (sort === "price-high") return right.priceCents - left.priceCents;
      return left.name.localeCompare(right.name);
    });
  }, [category, products, sort]);

  return (
    <>
      <div className="mt-10 flex flex-col gap-5 border-y border-[var(--border)] py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2 overflow-x-auto" aria-label="Product categories">
          {categories.map((categoryName) => (
            <button
              className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold ${
                category === categoryName
                  ? "bg-[var(--ink)] text-white"
                  : "bg-[var(--surface)] text-[var(--muted)]"
              }`}
              key={categoryName}
              onClick={() => setCategory(categoryName)}
              type="button"
            >
              {categoryName}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          Sort
          <select
            className="rounded-full border border-[var(--border)] bg-white px-4 py-2"
            onChange={(event) => setSort(event.target.value)}
            value={sort}
          >
            <option value="featured">Featured</option>
            <option value="price-low">Price: low to high</option>
            <option value="price-high">Price: high to low</option>
          </select>
        </label>
      </div>
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {visibleProducts.map((product, index) => {
          const isSoldOut = product.availableQuantity === 0;
          return (
            <article
              className="group overflow-hidden rounded-[2rem] border border-[var(--border)] bg-white"
              key={product.id}
            >
              <div className={`relative grid aspect-[4/3] place-items-center ${index % 2 ? "bg-[#eef0e7]" : "bg-[var(--brand-soft)]"}`}>
                {isSoldOut && (
                  <span className="absolute left-4 top-4 z-10 rounded-full bg-[var(--ink)] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white">
                    Sold out
                  </span>
                )}
                <Image
                  alt=""
                  className="h-3/4 w-3/4 object-contain transition duration-300 group-hover:scale-105"
                  height={360}
                  src={product.imageUrl ?? "/purim-ribbon.svg"}
                  width={480}
                />
                <button
                  className="absolute bottom-4 rounded-full bg-white px-5 py-2.5 text-sm font-bold opacity-0 shadow-lg transition group-hover:opacity-100 focus:opacity-100"
                  onClick={() => setQuickViewProduct(product)}
                  type="button"
                >
                  Quick view
                </button>
              </div>
              <div className="p-6">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--brand)]">
                  {product.category}
                </p>
                <div className="mt-2 flex items-start justify-between gap-4">
                  <h2 className="text-xl font-bold">{product.name}</h2>
                  <p className="whitespace-nowrap font-bold">{formatCurrency(product.priceCents)}</p>
                </div>
                <p className="mt-3 line-clamp-2 text-sm leading-6 text-[var(--muted)]">
                  {product.description}
                </p>
                <Link
                  className="mt-5 inline-block text-sm font-bold text-[var(--brand)]"
                  href={`/catalog/${product.id}`}
                >
                  View details →
                </Link>
              </div>
            </article>
          );
        })}
      </div>
      {visibleProducts.length === 0 && (
        <p className="py-20 text-center text-[var(--muted)]">No gifts match this category.</p>
      )}
      {quickViewProduct && (
        <div
          aria-label={`Quick view ${quickViewProduct.name}`}
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-[var(--ink)]/60 p-5"
          role="dialog"
        >
          <div className="relative grid max-h-[90vh] w-full max-w-3xl overflow-auto rounded-[2rem] bg-white md:grid-cols-2">
            <button
              aria-label="Close quick view"
              className="absolute right-4 top-4 z-10 grid size-10 place-items-center rounded-full bg-white shadow"
              onClick={() => setQuickViewProduct(null)}
              type="button"
            >
              ×
            </button>
            <div className="grid min-h-72 place-items-center bg-[var(--brand-soft)] p-8">
              <Image
                alt=""
                className="h-auto w-full"
                height={420}
                src={quickViewProduct.imageUrl ?? "/purim-ribbon.svg"}
                width={560}
              />
            </div>
            <div className="p-8">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--brand)]">
                {quickViewProduct.category}
              </p>
              <h2 className="mt-3 text-3xl font-black">{quickViewProduct.name}</h2>
              <p className="mt-3 text-xl font-bold">{formatCurrency(quickViewProduct.priceCents)}</p>
              <p className="mt-5 leading-7 text-[var(--muted)]">{quickViewProduct.description}</p>
              {quickViewProduct.options.length > 0 && (
                <div className="mt-6">
                  <p className="text-sm font-bold">Available options</p>
                  <ul className="mt-2 space-y-2 text-sm text-[var(--muted)]">
                    {quickViewProduct.options.map((option) => (
                      <li key={option.id}>
                        {option.value}
                        {option.priceAdjustmentCents > 0 &&
                          ` +${formatCurrency(option.priceAdjustmentCents)}`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Link
                className="mt-7 block rounded-full bg-[var(--brand)] px-6 py-3 text-center font-bold text-white"
                href={`/catalog/${quickViewProduct.id}`}
              >
                See full details
              </Link>
              {!isOpen && (
                <p className="mt-3 text-center text-sm text-[var(--muted)]">This collection is browse-only.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
