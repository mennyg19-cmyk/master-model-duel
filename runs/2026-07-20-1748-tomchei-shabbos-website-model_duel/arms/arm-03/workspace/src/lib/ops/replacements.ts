import { db } from "@/lib/db";

export type ReplacementCandidate = {
  productId: string;
  name: string;
  sku: string;
  seasonId: string;
  basePriceCents: number;
  isActive: boolean;
  chain: string[];
};

/** Walk ProductReplacement edges until products in targetSeason (R-048, G-013). */
export async function resolveReplacementChain(
  fromProductId: string,
  targetSeasonId: string,
  maxDepth = 8,
): Promise<ReplacementCandidate[]> {
  const edges = await db.productReplacement.findMany({
    select: { fromProductId: true, toProductId: true },
  });
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.fromProductId) ?? [];
    list.push(edge.toProductId);
    adjacency.set(edge.fromProductId, list);
  }

  const found = new Map<string, { chain: string[] }>();
  const queue: Array<{ id: string; chain: string[]; depth: number }> = [
    { id: fromProductId, chain: [fromProductId], depth: 0 },
  ];
  const seen = new Set<string>([fromProductId]);

  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.depth >= maxDepth) continue;
    for (const next of adjacency.get(cur.id) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      const chain = [...cur.chain, next];
      queue.push({ id: next, chain, depth: cur.depth + 1 });
      found.set(next, { chain });
    }
  }

  const candidateIds = [...found.keys()];
  if (candidateIds.length === 0) return [];

  const products = await db.product.findMany({
    where: { id: { in: candidateIds }, seasonId: targetSeasonId },
  });

  return products.map((p) => ({
    productId: p.id,
    name: p.name,
    sku: p.sku,
    seasonId: p.seasonId,
    basePriceCents: p.basePriceCents,
    isActive: p.isActive,
    chain: found.get(p.id)?.chain ?? [fromProductId, p.id],
  }));
}

/** Closest price among mapped targets (price-smart default). */
export function pickPriceSmartDefault(
  candidates: ReplacementCandidate[],
  sourcePriceCents: number,
): ReplacementCandidate | null {
  const active = candidates.filter((c) => c.isActive);
  const pool = active.length ? active : candidates;
  if (pool.length === 0) return null;
  return [...pool].sort(
    (a, b) =>
      Math.abs(a.basePriceCents - sourcePriceCents) -
        Math.abs(b.basePriceCents - sourcePriceCents) ||
      a.name.localeCompare(b.name),
  )[0];
}

export type RepeatLinePreview = {
  sourceLineId: string;
  sourceProductId: string;
  sourceProductName: string;
  sourceSku: string;
  sourcePriceCents: number;
  quantity: number;
  recipientName: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  savedAddressId: string | null;
  fulfillmentMethodId: string | null;
  greeting: string | null;
  productOptionId: string | null;
  optionAdjustCents: number;
  addOns: Array<{ addOnId: string; quantity: number; unitPriceCents: number }>;
  status: "mapped" | "unmapped" | "same_season";
  candidates: ReplacementCandidate[];
  suggestedProductId: string | null;
};

export async function buildRepeatLinePreviews(
  sourceOrderId: string,
  targetSeasonId: string,
): Promise<RepeatLinePreview[]> {
  const lines = await db.orderLine.findMany({
    where: { orderId: sourceOrderId },
    include: { product: true, addOns: true },
    orderBy: { createdAt: "asc" },
  });

  const previews: RepeatLinePreview[] = [];
  for (const line of lines) {
    const sourcePrice =
      line.unitPriceCents + line.optionAdjustCents;
    let status: RepeatLinePreview["status"] = "unmapped";
    let candidates: ReplacementCandidate[] = [];
    let suggestedProductId: string | null = null;

    if (line.product.seasonId === targetSeasonId && line.product.isActive) {
      status = "same_season";
      suggestedProductId = line.productId;
      candidates = [
        {
          productId: line.product.id,
          name: line.product.name,
          sku: line.product.sku,
          seasonId: line.product.seasonId,
          basePriceCents: line.product.basePriceCents,
          isActive: line.product.isActive,
          chain: [line.productId],
        },
      ];
    } else {
      candidates = await resolveReplacementChain(line.productId, targetSeasonId);
      const pick = pickPriceSmartDefault(candidates, sourcePrice);
      if (pick) {
        status = "mapped";
        suggestedProductId = pick.productId;
      }
    }

    previews.push({
      sourceLineId: line.id,
      sourceProductId: line.productId,
      sourceProductName: line.product.name,
      sourceSku: line.product.sku,
      sourcePriceCents: sourcePrice,
      quantity: line.quantity,
      recipientName: line.recipientName,
      addressLine1: line.addressLine1,
      city: line.city,
      state: line.state,
      postalCode: line.postalCode,
      country: line.country,
      savedAddressId: line.savedAddressId,
      fulfillmentMethodId: line.fulfillmentMethodId,
      greeting: line.greeting,
      productOptionId: line.productOptionId,
      optionAdjustCents: line.optionAdjustCents,
      addOns: line.addOns.map((a) => ({
        addOnId: a.addOnId,
        quantity: a.quantity,
        unitPriceCents: a.unitPriceCents,
      })),
      status,
      candidates,
      suggestedProductId,
    });
  }
  return previews;
}
