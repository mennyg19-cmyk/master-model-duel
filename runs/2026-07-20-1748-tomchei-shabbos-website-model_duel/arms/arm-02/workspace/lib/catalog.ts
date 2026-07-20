import { db } from "@/lib/db";

export type CatalogProduct = {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  description: string | null;
  basePriceCents: number;
  imageUrl: string | null;
  soldOut: boolean;
  options: { id: string; name: string; priceAdjustmentCents: number }[];
};

/**
 * Active products for one season with the storefront's availability view.
 * Sold-out (R-016) = tracked inventory with nothing left after reservations;
 * untracked products never sell out.
 */
export async function getCatalogProducts(seasonId: string): Promise<CatalogProduct[]> {
  const products = await db.product.findMany({
    where: { seasonId, isActive: true },
    include: { options: { where: { isActive: true } }, inventoryItem: true, image: true },
    orderBy: { name: "asc" },
  });
  return products.map((product) => ({
    id: product.id,
    name: product.name,
    slug: product.slug,
    category: product.category,
    description: product.description,
    basePriceCents: product.basePriceCents,
    imageUrl: product.image?.url ?? null,
    soldOut:
      product.trackInventory && product.inventoryItem
        ? product.inventoryItem.quantityOnHand - product.inventoryItem.reserved <= 0
        : false,
    options: product.options.map((option) => ({
      id: option.id,
      name: option.name,
      priceAdjustmentCents: option.priceAdjustmentCents,
    })),
  }));
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
