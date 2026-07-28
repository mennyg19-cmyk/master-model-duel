import { formatCents } from "@/lib/money";

// "From" pricing for catalog surfaces (storefront grid, builder cards): the
// cheapest option configuration anchors the label. Any product shape with
// option price deltas fits — GridProduct and BuilderProduct both do.
export interface PricedCatalogProduct {
  basePriceCents: number;
  options: { values: { priceDeltaCents: number }[] }[];
}

export function lowestPriceCents(product: PricedCatalogProduct): number {
  const deltas = product.options.flatMap((option) => option.values.map((value) => value.priceDeltaCents));
  return product.basePriceCents + Math.min(0, ...deltas);
}

export function priceLabel(product: PricedCatalogProduct): string {
  // lowestPriceCents can never exceed the base price, so options alone decide
  // the "from" prefix.
  return product.options.length > 0
    ? `from ${formatCents(lowestPriceCents(product))}`
    : formatCents(product.basePriceCents);
}
