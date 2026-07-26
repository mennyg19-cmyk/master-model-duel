import 'server-only';

import type { Prisma, Season } from '@prisma/client';

import { db } from '../db';
import type { CatalogProduct } from './browse';

const CATALOG_INCLUDE = {
  image: true,
  options: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] },
  inventory: true,
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof CATALOG_INCLUDE }>;

/**
 * What the current season sells. Inactive products are hidden here but kept in
 * the archive, because a product pulled mid-season should stop selling without
 * erasing the year it belonged to.
 */
export async function currentSeasonCatalog(seasonId: string): Promise<CatalogProduct[]> {
  return readCatalog({ seasonId, isActive: true });
}

/** Archive years show everything that season carried, active or not (G-022). */
export async function archivedSeasonCatalog(seasonId: string): Promise<CatalogProduct[]> {
  return readCatalog({ seasonId });
}

export async function findCatalogProduct(
  seasonId: string,
  slug: string,
): Promise<CatalogProduct | null> {
  const product = await db.product.findUnique({
    where: { seasonId_slug: { seasonId, slug } },
    include: CATALOG_INCLUDE,
  });

  return product ? toCatalogProduct(product) : null;
}

export async function findSeasonByYear(year: number): Promise<Season | null> {
  return db.season.findUnique({ where: { year } });
}

/** Every season older than the one on display, newest first (R-005). */
export async function pastSeasons(currentYear: number | null): Promise<Season[]> {
  return db.season.findMany({
    where: currentYear === null ? {} : { year: { lt: currentYear } },
    orderBy: { year: 'desc' },
  });
}

async function readCatalog(where: Prisma.ProductWhereInput): Promise<CatalogProduct[]> {
  const products = await db.product.findMany({
    where,
    include: CATALOG_INCLUDE,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  return products.map(toCatalogProduct);
}

function toCatalogProduct(product: ProductRow): CatalogProduct {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    category: product.category,
    priceCents: product.priceCents,
    isSoldOut: isSoldOut(product),
    sortOrder: product.sortOrder,
    imageUrl: product.image?.url ?? null,
    imageAltText: product.image?.altText ?? null,
    options: product.options.map((option) => ({
      groupLabel: option.groupLabel,
      label: option.label,
      priceAdjustmentCents: option.priceAdjustmentCents,
    })),
  };
}

/**
 * A stock-tracked product with no inventory row cannot be sold — finalize
 * refuses it — so the storefront calls that sold out rather than letting someone
 * fill a cart with it.
 */
function isSoldOut(product: ProductRow): boolean {
  if (!product.tracksInventory) return false;
  if (!product.inventory) return true;
  return product.inventory.onHand - product.inventory.reserved <= 0;
}
