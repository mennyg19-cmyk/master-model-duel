"use client";

import { useMemo, useState } from "react";

type CatalogProduct = {
  id: string;
  name: string;
  description: string | null;
  kind: "PACKAGE" | "ADD_ON" | "DONATION";
  priceCents: number;
  media: { url: string } | null;
  options: { id: string; name: string; value: string; priceAdjustmentCents: number }[];
  inventoryItems: { quantityOnHand: number; quantityReserved: number }[];
};

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function CatalogGrid({ products, canOrder }: { products: CatalogProduct[]; canOrder: boolean }) {
  const [kind, setKind] = useState<"ALL" | CatalogProduct["kind"]>("ALL");
  const [sort, setSort] = useState<"featured" | "price-low" | "price-high">("featured");
  const [quickView, setQuickView] = useState<CatalogProduct | null>(null);
  const visibleProducts = useMemo(() => products
    .filter((product) => kind === "ALL" || product.kind === kind)
    .sort((left, right) => {
      if (sort === "price-low") return left.priceCents - right.priceCents;
      if (sort === "price-high") return right.priceCents - left.priceCents;
      return left.name.localeCompare(right.name);
    }), [kind, products, sort]);

  return (
    <>
      <div className="catalog-tools">
        <label>Filter
          <select aria-label="Filter catalog" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="ALL">All collections</option>
            <option value="PACKAGE">Mishloach manos</option>
            <option value="DONATION">Donations</option>
          </select>
        </label>
        <label>Sort
          <select aria-label="Sort catalog" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="featured">Featured</option>
            <option value="price-low">Price: low to high</option>
            <option value="price-high">Price: high to low</option>
          </select>
        </label>
      </div>
      <div className="catalog-grid">
        {visibleProducts.map((product) => {
          const available = product.inventoryItems.every((inventory) => inventory.quantityOnHand > inventory.quantityReserved);
          return (
            <article className="product-card" key={product.id}>
              {product.media ? <img alt="" src={product.media.url} /> : <div className="product-placeholder">Purim collection</div>}
              <p className="eyebrow">{product.kind === "DONATION" ? "Give" : "Mishloach manos"}</p>
              <h2>{product.name}</h2>
              <p>{product.description ?? "A thoughtful Purim gift, packed and delivered with care."}</p>
              <strong>{formatMoney(product.priceCents)}</strong>
              {!available && <p className="sold-out">Sold out</p>}
              <div className="product-actions">
                <button className="button secondary" onClick={() => setQuickView(product)}>Quick view</button>
                {canOrder && available && <a className="button" href="/order">Start an order</a>}
              </div>
            </article>
          );
        })}
      </div>
      {quickView && (
        <section aria-label={`${quickView.name} details`} className="quick-view">
          <button aria-label="Close quick view" className="close" onClick={() => setQuickView(null)}>×</button>
          <p className="eyebrow">Quick view</p>
          <h2>{quickView.name}</h2>
          <p>{quickView.description}</p>
          <p><strong>From {formatMoney(quickView.priceCents)}</strong></p>
          {quickView.options.length > 0 && (
            <ul>
              {quickView.options.map((option) => <li key={option.id}>{option.name}: {option.value} ({option.priceAdjustmentCents >= 0 ? "+" : ""}{formatMoney(option.priceAdjustmentCents)})</li>)}
            </ul>
          )}
          {canOrder && <a className="button" href="/order">Start an order</a>}
        </section>
      )}
    </>
  );
}
