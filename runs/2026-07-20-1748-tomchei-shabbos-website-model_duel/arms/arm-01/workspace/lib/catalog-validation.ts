import { db } from "@/lib/db";

/**
 * Server-side referential checks for admin catalog writes. Prisma FK errors
 * would otherwise surface as 500s, and cross-season references would persist
 * silently (R-147/R-148).
 */

/** Returns an error message when a restricted-product id is missing or belongs to another season. */
export async function validateRestrictedProductIds(
  productIds: string[],
  seasonId: string
): Promise<string | null> {
  if (productIds.length === 0) return null;
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, seasonId: true },
  });
  const bySeasonId = new Map(products.map((product) => [product.id, product.seasonId]));
  for (const productId of productIds) {
    const productSeasonId = bySeasonId.get(productId);
    if (!productSeasonId) return "One or more restricted products do not exist";
    if (productSeasonId !== seasonId) return "Restricted products must belong to the add-on's season";
  }
  return null;
}

/** Returns an error message when the season id does not exist. */
export async function validateSeasonExists(seasonId: string): Promise<string | null> {
  const season = await db.season.findUnique({ where: { id: seasonId }, select: { id: true } });
  return season ? null : "Season not found";
}
