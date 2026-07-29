/**
 * P10 (UR-007 / R-057): walk a product's `replacedBy` links across seasons.
 *
 * Mappings are forward-only (the product editor refuses a replacement in the
 * same or an older season), so a chain can't cycle — but we still carry a
 * visited set so a hand-edited or imported loop degrades into "discontinued"
 * instead of looping forever.
 */
import { prisma } from "@/lib/db";

export interface ChainHop {
  productId: string;
  name: string;
  seasonId: string;
}

export interface ChainResolution {
  /** Live product the chain lands on, in the target season. Null when the chain dies (unmapped discontinuation or dangling mapping). */
  final: { id: string; name: string } | null;
  hops: ChainHop[];
  deadEnd: boolean;
}

export async function resolveReplacementChain(
  productId: string,
  targetSeasonId: string,
  maxHops = 8,
): Promise<ChainResolution> {
  const hops: ChainHop[] = [];
  const seen = new Set<string>([productId]);
  let cursor: string | null = productId;

  for (let i = 0; i < maxHops && cursor; i++) {
    const product: {
      id: string;
      name: string;
      seasonId: string;
      active: boolean;
      replacedById: string | null;
    } | null = await prisma.product.findUnique({
      where: { id: cursor },
      select: { id: true, name: true, seasonId: true, active: true, replacedById: true },
    });
    if (!product) return { final: null, hops, deadEnd: true };
    if (product.seasonId === targetSeasonId) {
      return {
        final: product.active ? { id: product.id, name: product.name } : null,
        hops,
        deadEnd: !product.active,
      };
    }
    if (!product.replacedById || seen.has(product.replacedById)) {
      return { final: null, hops, deadEnd: true };
    }
    seen.add(product.replacedById);
    hops.push({ productId: product.id, name: product.name, seasonId: product.seasonId });
    cursor = product.replacedById;
  }
  // Ran out of hops: treat as dead end rather than guessing.
  return { final: null, hops, deadEnd: true };
}

/** Preview string for the admin product page: "Old A → Mid B → New C". */
export async function replacementChainPreview(
  productId: string,
  targetSeasonId: string,
): Promise<string | null> {
  const start = await prisma.product.findUnique({
    where: { id: productId },
    select: { name: true },
  });
  if (!start) return null;
  const chain = await resolveReplacementChain(productId, targetSeasonId);
  const names = [start.name, ...chain.hops.map((h) => h.name)];
  if (chain.final) names.push(chain.final.name);
  return names.join(" → ") + (chain.deadEnd ? " → (dead end)" : "");
}
