export type CatalogOption = {
  id: string;
  name: string;
  priceAdjustmentCents: number;
};

export type CatalogProductCard = {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  description: string | null;
  basePriceCents: number;
  tracksInventory: boolean;
  primaryImageUrl: string | null;
  mediaAsset: { url: string; altText: string | null } | null;
  inventory: { onHand: number; reserved: number } | null;
  options: CatalogOption[];
};

export function availableUnits(product: CatalogProductCard): number | null {
  if (!product.tracksInventory) return null;
  if (!product.inventory) return 0;
  return Math.max(0, product.inventory.onHand - product.inventory.reserved);
}

export function isSoldOut(product: CatalogProductCard): boolean {
  const units = availableUnits(product);
  return units !== null && units <= 0;
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
}
