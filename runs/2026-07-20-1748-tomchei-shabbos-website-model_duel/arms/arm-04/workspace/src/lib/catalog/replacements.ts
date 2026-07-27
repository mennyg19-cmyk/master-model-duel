import 'server-only';

import { formatCents } from '../core/money';
import { db } from '../db';

/**
 * Where last season's catalogue lands in this one (R-048, G-013).
 *
 * Two things can carry an item forward. The first is its slug: "the classic
 * box" is the same box a year later even though it is a fresh database row, and
 * that match wins outright — a mapping left over from the year the item was
 * nearly dropped must not swap something still on the shelf. The second is the
 * replacement link a manager sets, which is followed as a chain: a 2024 box
 * pointing at a 2025 box pointing at a 2026 box resolves to the 2026 one.
 *
 * A chain that runs out, loops, or never reaches a product on sale resolves to
 * nothing, and the caller has to ask a person.
 */
export type SeasonProduct = {
  id: string;
  slug: string;
  name: string;
  priceCents: number;
  category: string | null;
};

export type ReplacementResolution =
  /** Still sold under the same slug. */
  | { kind: 'same'; product: SeasonProduct; hops: 0; viaNames: string[] }
  /** Reached by following one or more replacement links. */
  | { kind: 'mapped'; product: SeasonProduct; hops: number; viaNames: string[] }
  | { kind: 'unmapped' };

/**
 * Eight seasons of links is already twice the longest chain the org could have,
 * and the cap is what stops a mapping loop from turning a page load into a walk
 * that never ends. The `seen` set catches the loop itself; this catches the
 * pathological-but-acyclic case.
 */
const MAX_CHAIN_HOPS = 8;

export function listSeasonCatalog(seasonId: string): Promise<SeasonProduct[]> {
  return db.product.findMany({
    where: { seasonId, isActive: true },
    select: { id: true, slug: true, name: true, priceCents: true, category: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

type Walk = { cursorId: string; viaNames: string[]; seen: Set<string> };
type ChainNode = { id: string; slug: string; name: string; replacedByProductId: string | null };

export async function resolveReplacements(
  sourceProductIds: string[],
  targetSeasonId: string,
): Promise<Map<string, ReplacementResolution>> {
  const ids = [...new Set(sourceProductIds)];
  const resolutions = new Map<string, ReplacementResolution>();
  if (ids.length === 0) return resolutions;

  const onSale = new Map((await listSeasonCatalog(targetSeasonId)).map((row) => [row.slug, row]));
  const sources = await db.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, slug: true, replacedByProductId: true },
  });

  const walking = new Map<string, Walk>();

  for (const source of sources) {
    const sameSlug = onSale.get(source.slug);
    if (sameSlug) {
      resolutions.set(source.id, { kind: 'same', product: sameSlug, hops: 0, viaNames: [] });
    } else if (source.replacedByProductId === null) {
      resolutions.set(source.id, { kind: 'unmapped' });
    } else {
      walking.set(source.id, {
        cursorId: source.replacedByProductId,
        viaNames: [],
        seen: new Set([source.id]),
      });
    }
  }

  // One query per hop rather than one per chain: every walk that is still going
  // advances together, so a hundred lines cost eight queries at worst.
  for (let hop = 1; hop <= MAX_CHAIN_HOPS && walking.size > 0; hop += 1) {
    const nodes = await readChainNodes([...new Set([...walking.values()].map((walk) => walk.cursorId))]);

    for (const [sourceId, walk] of walking) {
      const landed = advanceWalk(walk, nodes.get(walk.cursorId), onSale, hop);
      if (landed === null) continue;

      resolutions.set(sourceId, landed);
      walking.delete(sourceId);
    }
  }

  for (const sourceId of walking.keys()) resolutions.set(sourceId, { kind: 'unmapped' });

  return resolutions;
}

/**
 * One hop of a chain: the resolution it reached, or null when the walk is still
 * going and `walk` has been moved on to the next link.
 */
function advanceWalk(
  walk: Walk,
  node: ChainNode | undefined,
  onSale: Map<string, SeasonProduct>,
  hop: number,
): ReplacementResolution | null {
  if (!node || walk.seen.has(node.id)) return { kind: 'unmapped' };
  walk.seen.add(node.id);

  const landed = onSale.get(node.slug);
  if (landed) {
    return { kind: 'mapped', product: landed, hops: hop, viaNames: [...walk.viaNames, node.name] };
  }
  if (node.replacedByProductId === null) return { kind: 'unmapped' };

  walk.viaNames.push(node.name);
  walk.cursorId = node.replacedByProductId;
  return null;
}

async function readChainNodes(ids: string[]): Promise<Map<string, ChainNode>> {
  const nodes = await db.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, slug: true, name: true, replacedByProductId: true },
  });

  return new Map(nodes.map((node) => [node.id, node]));
}

/**
 * What the mappings dropdown may point at: this season's shelves, plus any row
 * already linked from an in-between season. Without the second half, a chain
 * that goes through 2026 to reach 2027 would render as "No mapping" and the
 * first save would quietly erase it.
 */
export async function mappingOptions(
  products: { replacedByProductId: string | null }[],
  catalog: SeasonProduct[],
): Promise<{ id: string; label: string }[]> {
  const inCatalog = new Set(catalog.map((product) => product.id));
  const linkedElsewhere = [
    ...new Set(
      products.flatMap((product) =>
        product.replacedByProductId && !inCatalog.has(product.replacedByProductId)
          ? [product.replacedByProductId]
          : [],
      ),
    ),
  ];

  const intermediate = await db.product.findMany({
    where: { id: { in: linkedElsewhere } },
    select: { id: true, name: true, priceCents: true, season: { select: { label: true } } },
    orderBy: { name: 'asc' },
  });

  return [
    ...catalog.map((product) => ({
      id: product.id,
      label: `${product.name} · ${formatCents(product.priceCents)}`,
    })),
    ...intermediate.map((product) => ({
      id: product.id,
      label: `${product.name} · ${formatCents(product.priceCents)} · ${product.season.label}`,
    })),
  ];
}

/**
 * The swap to put in front of somebody when nothing is mapped: the item closest
 * to what they paid last time, preferring its own category, because a donor who
 * spent $54 on a wine basket is being offered a wine basket rather than the
 * cheapest thing in the shop.
 *
 * A suggestion and nothing more — the review page starts blank and the customer
 * picks (UR-007).
 */
export function closestPricedProduct(
  candidates: SeasonProduct[],
  toPriceCents: number,
  category: string | null,
): SeasonProduct | null {
  const sameCategory = candidates.filter((row) => row.category === category);
  const pool = category !== null && sameCategory.length > 0 ? sameCategory : candidates;

  return pool.reduce<SeasonProduct | null>((best, row) => {
    if (best === null) return row;

    const gap = Math.abs(row.priceCents - toPriceCents);
    const bestGap = Math.abs(best.priceCents - toPriceCents);
    if (gap !== bestGap) return gap < bestGap ? row : best;

    // A tie goes to the cheaper item, then to the name, so the same catalogue
    // always suggests the same thing.
    if (row.priceCents !== best.priceCents) return row.priceCents < best.priceCents ? row : best;
    return row.name.localeCompare(best.name) < 0 ? row : best;
  }, null);
}
