import { CatalogManager } from "@/components/catalog-manager";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminCatalogPage() {
  await requirePermission("settings:manage");
  const [seasons, products] = await Promise.all([
    db.season.findMany({ orderBy: { year: "desc" } }),
    db.product.findMany({
      orderBy: [{ season: { year: "desc" } }, { name: "asc" }],
      include: { season: { select: { year: true } } },
    }),
  ]);

  return (
    <CatalogManager
      initialProducts={products.map((product) => ({
        id: product.id,
        seasonId: product.seasonId,
        seasonYear: product.season.year,
        sku: product.sku,
        name: product.name,
        description: product.description,
        category: product.category,
        kind: product.kind,
        priceCents: product.priceCents,
        imageUrl: product.imageUrl,
        replacementProductId: product.replacementProductId,
        isActive: product.isActive,
        version: product.version,
      }))}
      seasons={seasons.map((season) => ({
        id: season.id,
        name: season.name,
        year: season.year,
      }))}
    />
  );
}
