import { db } from "@/lib/db";
import { requirePermissionPage } from "@/lib/auth/current-user";
import { CatalogManager } from "@/components/admin/catalog-manager";

export default async function AdminCatalogPage() {
  await requirePermissionPage("catalog.manage");
  const seasons = await db.season.findMany({
    select: { id: true, name: true, status: true },
    orderBy: { createdAt: "desc" },
  });
  // Replacement links may point across seasons (R-048), so the picker needs
  // every product, not just the selected season's.
  const replacementCandidates = await db.product.findMany({
    select: { id: true, name: true, seasonId: true, isActive: true },
    orderBy: { name: "asc" },
  });
  const firstSeasonId = seasons[0]?.id;
  const [initialProducts, initialAddOns] = firstSeasonId
    ? await Promise.all([
        db.product.findMany({
          where: { seasonId: firstSeasonId },
          include: { options: true, inventoryItem: true, image: true, replacement: { select: { id: true, name: true } } },
          orderBy: { name: "asc" },
        }),
        db.addOn.findMany({
          where: { seasonId: firstSeasonId },
          include: { restrictions: { include: { product: { select: { id: true, name: true } } } } },
          orderBy: { name: "asc" },
        }),
      ])
    : [[], []];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Product catalog</h1>
      {seasons.length === 0 ? (
        <p className="text-muted">No seasons exist yet. Seed the database or create one via season management (P10).</p>
      ) : (
        <CatalogManager
          seasons={seasons}
          initialProducts={initialProducts}
          initialAddOns={initialAddOns}
          replacementCandidates={replacementCandidates}
        />
      )}
    </div>
  );
}
