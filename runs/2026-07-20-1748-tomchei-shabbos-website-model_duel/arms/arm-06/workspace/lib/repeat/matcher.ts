/**
 * P10 (UR-008 / R-057): price-smart suggestions for repeat lines whose chain
 * dead-ends. Picks the closest-priced active products in the open season,
 * preferring the same category as the original item. Never silently maps —
 * the customer/staff picks one on the review page or removes the line.
 */
import { prisma } from "@/lib/db";

export interface PriceSuggestion {
  productId: string;
  name: string;
  priceCents: number;
  priceDeltaCents: number;
}

export async function suggestByPrice(
  sourceProductId: string,
  targetSeasonId: string,
  limit = 3,
): Promise<PriceSuggestion[]> {
  const source = await prisma.product.findUnique({
    where: { id: sourceProductId },
    select: { basePriceCents: true, category: true },
  });
  if (!source) return [];

  const candidates = await prisma.product.findMany({
    where: { seasonId: targetSeasonId, active: true },
    select: { id: true, name: true, basePriceCents: true, category: true },
    orderBy: { basePriceCents: "asc" },
  });

  return candidates
    .map((c) => ({
      productId: c.id,
      name: c.name,
      priceCents: c.basePriceCents,
      priceDeltaCents: c.basePriceCents - source.basePriceCents,
      sameCategory: c.category === source.category,
    }))
    .sort((a, b) => {
      if (a.sameCategory !== b.sameCategory) return a.sameCategory ? -1 : 1;
      return Math.abs(a.priceDeltaCents) - Math.abs(b.priceDeltaCents);
    })
    .slice(0, limit)
    .map(({ sameCategory: _sameCategory, ...suggestion }) => suggestion);
}
