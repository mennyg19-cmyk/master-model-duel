import { ProductKind, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  availableUnits,
  formatCents,
  isSoldOut,
  type CatalogProductCard,
} from "@/lib/storefront/catalog-shared";

export type CatalogSort = "price-asc" | "price-desc" | "name";
export { availableUnits, formatCents, isSoldOut };
export type { CatalogProductCard };

const productInclude = {
  options: { where: { isActive: true }, orderBy: { sortOrder: "asc" as const } },
  inventory: true,
  mediaAsset: true,
} satisfies Prisma.ProductInclude;

export type CatalogProduct = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

export function toProductCard(product: CatalogProduct): CatalogProductCard {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    category: product.category,
    description: product.description,
    basePriceCents: product.basePriceCents,
    tracksInventory: product.tracksInventory,
    primaryImageUrl: product.primaryImageUrl,
    mediaAsset: product.mediaAsset
      ? { url: product.mediaAsset.url, altText: product.mediaAsset.altText }
      : null,
    inventory: product.inventory
      ? { onHand: product.inventory.onHand, reserved: product.inventory.reserved }
      : null,
    options: product.options.map((opt) => ({
      id: opt.id,
      name: opt.name,
      priceAdjustmentCents: opt.priceAdjustmentCents,
    })),
  };
}

export async function listCatalogProducts(opts: {
  seasonId: string;
  category?: string | null;
  sort?: CatalogSort;
  kinds?: ProductKind[];
}): Promise<CatalogProduct[]> {
  const where: Prisma.ProductWhereInput = {
    seasonId: opts.seasonId,
    isActive: true,
    kind: { in: opts.kinds ?? [ProductKind.PACKAGE, ProductKind.MERCH, ProductKind.DONATION] },
  };
  if (opts.category) where.category = opts.category;

  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    opts.sort === "price-asc"
      ? [{ basePriceCents: "asc" }, { sortOrder: "asc" }]
      : opts.sort === "price-desc"
        ? [{ basePriceCents: "desc" }, { sortOrder: "asc" }]
        : opts.sort === "name"
          ? [{ name: "asc" }]
          : [{ sortOrder: "asc" }, { name: "asc" }];

  return db.product.findMany({ where, include: productInclude, orderBy });
}

export async function listCategories(seasonId: string): Promise<string[]> {
  const rows = await db.product.findMany({
    where: { seasonId, isActive: true, category: { not: null } },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });
  return rows.map((row) => row.category!).filter(Boolean);
}

export async function getProductBySlug(
  seasonId: string,
  slug: string,
): Promise<CatalogProduct | null> {
  return db.product.findUnique({
    where: { seasonId_slug: { seasonId, slug } },
    include: productInclude,
  });
}
