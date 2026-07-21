import { db } from "@/lib/db";

export type ReplacementCandidate = {
  productId: string;
  sku: string;
  name: string;
  seasonId: string;
  basePriceCents: number;
  isActive: boolean;
  hopCount: number;
};

export type ResolvedReplacement = {
  sourceProductId: string;
  sourceSku: string;
  sourceName: string;
  sourcePriceCents: number;
  sourceSeasonId: string;
  /** True when source is already in the target season and active. */
  alreadyInTarget: boolean;
  candidates: ReplacementCandidate[];
  /** Closest price among candidates in the target season (G-013 / price-smart). */
  priceSmartProductId: string | null;
  /** True when no candidate lands in the target season. */
  needsPick: boolean;
};

/**
 * Walk ProductReplacement edges (BFS) until products in `targetSeasonId` are reached.
 * Direct same-season keep is allowed when the source itself is still active there.
 */
export async function resolveReplacementChain(
  sourceProductId: string,
  targetSeasonId: string,
): Promise<ResolvedReplacement> {
  const source = await db.product.findUniqueOrThrow({
    where: { id: sourceProductId },
  });

  if (source.seasonId === targetSeasonId && source.isActive) {
    return {
      sourceProductId: source.id,
      sourceSku: source.sku,
      sourceName: source.name,
      sourcePriceCents: source.basePriceCents,
      sourceSeasonId: source.seasonId,
      alreadyInTarget: true,
      candidates: [
        {
          productId: source.id,
          sku: source.sku,
          name: source.name,
          seasonId: source.seasonId,
          basePriceCents: source.basePriceCents,
          isActive: source.isActive,
          hopCount: 0,
        },
      ],
      priceSmartProductId: source.id,
      needsPick: false,
    };
  }

  const visited = new Set<string>([source.id]);
  const queue: Array<{ productId: string; hopCount: number }> = [
    { productId: source.id, hopCount: 0 },
  ];
  const targetHits = new Map<string, ReplacementCandidate>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    const edges = await db.productReplacement.findMany({
      where: { fromProductId: current.productId },
      include: { toProduct: true },
    });

    for (const edge of edges) {
      const next = edge.toProduct;
      if (visited.has(next.id)) continue;
      visited.add(next.id);
      const hopCount = current.hopCount + 1;

      if (next.seasonId === targetSeasonId && next.isActive) {
        const existing = targetHits.get(next.id);
        if (!existing || hopCount < existing.hopCount) {
          targetHits.set(next.id, {
            productId: next.id,
            sku: next.sku,
            name: next.name,
            seasonId: next.seasonId,
            basePriceCents: next.basePriceCents,
            isActive: next.isActive,
            hopCount,
          });
        }
      }

      // Continue chain across seasons (R-048 / G-013).
      if (hopCount < 8) {
        queue.push({ productId: next.id, hopCount });
      }
    }
  }

  // Also match by SKU in the target season when no explicit mapping exists.
  if (targetHits.size === 0) {
    const bySku = await db.product.findFirst({
      where: {
        seasonId: targetSeasonId,
        sku: source.sku,
        isActive: true,
      },
    });
    if (bySku) {
      targetHits.set(bySku.id, {
        productId: bySku.id,
        sku: bySku.sku,
        name: bySku.name,
        seasonId: bySku.seasonId,
        basePriceCents: bySku.basePriceCents,
        isActive: bySku.isActive,
        hopCount: 0,
      });
    }
  }

  const candidates = [...targetHits.values()].sort(
    (a, b) =>
      Math.abs(a.basePriceCents - source.basePriceCents) -
        Math.abs(b.basePriceCents - source.basePriceCents) ||
      a.hopCount - b.hopCount ||
      a.name.localeCompare(b.name),
  );

  const priceSmartProductId = candidates[0]?.productId ?? null;

  return {
    sourceProductId: source.id,
    sourceSku: source.sku,
    sourceName: source.name,
    sourcePriceCents: source.basePriceCents,
    sourceSeasonId: source.seasonId,
    alreadyInTarget: false,
    candidates,
    priceSmartProductId,
    needsPick: candidates.length === 0,
  };
}

export function pickPriceSmart(
  sourcePriceCents: number,
  candidates: Array<{ productId: string; basePriceCents: number }>,
): string | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (a, b) =>
      Math.abs(a.basePriceCents - sourcePriceCents) -
      Math.abs(b.basePriceCents - sourcePriceCents),
  )[0]!.productId;
}
