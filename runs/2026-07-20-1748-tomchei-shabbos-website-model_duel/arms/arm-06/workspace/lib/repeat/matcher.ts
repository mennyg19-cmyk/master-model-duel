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

  // Bounded pool (m16): the nearest-priced products on both sides of the
  // source price — overall and within the source's category — instead of the
  // whole season catalog. The final sort still prefers same-category, so the
  // category side is pooled separately to stay eligible.
  const POOL_PER_SIDE = 12;
  const select = { id: true, name: true, basePriceCents: true, category: true } as const;
  const scope = { seasonId: targetSeasonId, active: true };
  const [overallAbove, overallBelow, categoryAbove, categoryBelow] = await Promise.all([
    prisma.product.findMany({
      where: { ...scope, basePriceCents: { gte: source.basePriceCents } },
      select,
      orderBy: { basePriceCents: "asc" },
      take: POOL_PER_SIDE,
    }),
    prisma.product.findMany({
      where: { ...scope, basePriceCents: { lt: source.basePriceCents } },
      select,
      orderBy: { basePriceCents: "desc" },
      take: POOL_PER_SIDE,
    }),
    prisma.product.findMany({
      where: { ...scope, category: source.category, basePriceCents: { gte: source.basePriceCents } },
      select,
      orderBy: { basePriceCents: "asc" },
      take: POOL_PER_SIDE,
    }),
    prisma.product.findMany({
      where: { ...scope, category: source.category, basePriceCents: { lt: source.basePriceCents } },
      select,
      orderBy: { basePriceCents: "desc" },
      take: POOL_PER_SIDE,
    }),
  ]);
  const pool = new Map<string, (typeof overallAbove)[number]>();
  for (const candidate of [...overallAbove, ...overallBelow, ...categoryAbove, ...categoryBelow]) {
    pool.set(candidate.id, candidate);
  }

  return [...pool.values()]
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
