import { Prisma } from "@prisma/client";

// Catalog query shape shared by the grid, quick view, and detail page.
export const catalogProductInclude = {
  options: { include: { values: { orderBy: { priceDeltaCents: "asc" } } }, orderBy: { name: "asc" } },
  allowedAddOns: { include: { addOn: true } },
  inventoryItem: true,
  media: { orderBy: { createdAt: "asc" }, take: 1 },
} satisfies Prisma.ProductInclude;

export type CatalogProduct = Prisma.ProductGetPayload<{ include: typeof catalogProductInclude }>;

// Untracked products have no stock ceiling (null); tracked products without
// an inventory row have none available.
export function availableStock(product: {
  trackInventory: boolean;
  inventoryItem: { onHand: number; reserved: number } | null;
}): number | null {
  if (!product.trackInventory) return null;
  if (!product.inventoryItem) return 0;
  return product.inventoryItem.onHand - product.inventoryItem.reserved;
}

// R-017: sold out = tracked stock fully committed. Untracked items are never
// sold out; allowBackorder keeps the buy path open even at zero (badge only).
export function isSoldOut(product: {
  trackInventory: boolean;
  allowBackorder: boolean;
  inventoryItem: { onHand: number; reserved: number } | null;
}): boolean {
  const stock = availableStock(product);
  return stock !== null && stock <= 0 && !product.allowBackorder;
}
