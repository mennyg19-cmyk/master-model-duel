import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addressInputSchema } from "@/lib/addresses/normalize";
import type { Cart, CartLine } from "@/lib/order-builder/cart";
import { appendLinesToDraft, applyAssignmentRules, posDraftOwner, type DraftOwner } from "@/lib/order-builder/draft-store";

// Repeat orders (UR-007, R-057, R-058) + replacement chains (R-048, G-013).
// A repeat copies a prior order's lines into a builder draft in the OPEN
// season: products map through the admin replacement links, recipients ride
// along as address snapshots (auto-saved to the book on draft save — G-012),
// and greetings carry per line. Anything that can't map is either picked by a
// human (customer review page) or price-smart-suggested (staff auto repeat).

const MAX_CHAIN_HOPS = 25;

export type ChainProduct = {
  id: string;
  seasonId: string;
  isActive: boolean;
  replacementId: string | null;
};

/**
 * Walk the replacement chain from a product until it lands on an ACTIVE
 * product in the target season. Chains may cross seasons (2024 → 2025 → 2026);
 * cycles and dead ends return null. `chain` is every hop taken, for display.
 */
export function resolveReplacementChain(
  startId: string,
  productById: Map<string, ChainProduct>,
  targetSeasonId: string
): { productId: string | null; chain: string[] } {
  const chain: string[] = [];
  const seen = new Set([startId]);
  let currentId = productById.get(startId)?.replacementId ?? null;
  while (currentId && !seen.has(currentId) && chain.length < MAX_CHAIN_HOPS) {
    seen.add(currentId);
    chain.push(currentId);
    const product = productById.get(currentId);
    if (!product) break;
    if (product.seasonId === targetSeasonId && product.isActive) {
      return { productId: currentId, chain };
    }
    currentId = product.replacementId;
  }
  return { productId: null, chain };
}

/** True when setting `replacementId` on `productId` would close a loop. */
export function wouldCreateReplacementCycle(
  productId: string,
  replacementId: string,
  productById: Map<string, ChainProduct>
): boolean {
  let currentId: string | null = replacementId;
  for (let hop = 0; currentId && hop < MAX_CHAIN_HOPS; hop += 1) {
    if (currentId === productId) return true;
    currentId = productById.get(currentId)?.replacementId ?? null;
  }
  return false;
}

export type RepeatCandidate = { id: string; name: string; basePriceCents: number };

/** Price-smart default (G-011): the active product priced closest to what the line cost; ties go to the cheaper one. */
export function closestPricedProduct(
  targetCents: number,
  candidates: RepeatCandidate[]
): RepeatCandidate | null {
  let best: RepeatCandidate | null = null;
  for (const candidate of candidates) {
    if (!best) {
      best = candidate;
      continue;
    }
    const bestDiff = Math.abs(best.basePriceCents - targetCents);
    const diff = Math.abs(candidate.basePriceCents - targetCents);
    if (diff < bestDiff || (diff === bestDiff && candidate.basePriceCents < best.basePriceCents)) {
      best = candidate;
    }
  }
  return best;
}

export type RepeatRecipient = {
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  zip: string;
};

export type RepeatPlanLine = {
  lineId: string;
  originalProductName: string;
  quantity: number;
  unitPriceCents: number;
  greeting: string;
  recipient: RepeatRecipient;
  /** Address snapshots from imports can fail today's validation — those lines enter the cart unassigned. */
  recipientValid: boolean;
  mapping:
    | { kind: "same"; productId: string; productName: string }
    | { kind: "replacement"; productId: string; productName: string; chainNames: string[] }
    | { kind: "unmapped"; suggestedProductId: string | null };
  /** Option/add-on names that cannot carry across products/seasons. */
  dropped: string[];
  /** Options/add-ons that DO carry (same product, still active). */
  carryOptionIds: string[];
  carryAddOns: { addOnId: string; quantity: number }[];
};

export type RepeatPlan = {
  orderId: string;
  orderLabel: string;
  sourceSeasonName: string;
  targetSeasonId: string;
  targetSeasonName: string;
  lines: RepeatPlanLine[];
  candidates: RepeatCandidate[];
};

const orderInclude = {
  season: { select: { name: true } },
  lines: {
    include: {
      product: { select: { id: true, name: true } },
      options: { include: { productOption: { select: { id: true, name: true, isActive: true } } } },
      addOns: { include: { addOn: { select: { id: true, name: true, isActive: true } } } },
    },
    orderBy: { id: "asc" as const },
  },
} satisfies Prisma.OrderInclude;

type RepeatableOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export async function loadRepeatableOrder(orderId: string): Promise<RepeatableOrder | null> {
  return db.order.findUnique({ where: { id: orderId }, include: orderInclude });
}

export type CatalogProduct = ChainProduct & { name: string; basePriceCents: number };

/** The catalog-wide product list the plan builder needs. Fetch once and pass it through when planning in a loop (bulk repeat). */
export async function loadRepeatCatalog(): Promise<CatalogProduct[]> {
  return db.product.findMany({
    select: { id: true, name: true, seasonId: true, isActive: true, replacementId: true, basePriceCents: true },
  });
}

/**
 * Map every line of a prior order into the target season. One catalog-wide
 * product fetch backs both the chain walk (chains hop across seasons) and the
 * price-smart candidate list.
 */
export async function buildRepeatPlan(
  order: RepeatableOrder,
  targetSeason: { id: string; name: string },
  catalog?: CatalogProduct[]
): Promise<RepeatPlan> {
  const allProducts = catalog ?? (await loadRepeatCatalog());
  const productById = new Map(allProducts.map((product) => [product.id, product]));
  const candidates: RepeatCandidate[] = allProducts
    .filter((product) => product.seasonId === targetSeason.id && product.isActive)
    .map(({ id, name, basePriceCents }) => ({ id, name, basePriceCents }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const lines: RepeatPlanLine[] = order.lines.map((line) => {
    const original = productById.get(line.productId);
    let dropped: string[] = [
      ...line.options.map((option) => option.productOption.name),
      ...line.addOns.map((entry) => entry.addOn.name),
    ];
    let carryOptionIds: string[] = [];
    let carryAddOns: { addOnId: string; quantity: number }[] = [];

    let mapping: RepeatPlanLine["mapping"];
    if (original && original.seasonId === targetSeason.id && original.isActive) {
      mapping = { kind: "same", productId: original.id, productName: original.name };
      // Same product: still-active options/add-ons carry; retired ones are reported.
      carryOptionIds = line.options
        .filter((option) => option.productOption.isActive)
        .map((option) => option.productOption.id);
      carryAddOns = line.addOns
        .filter((entry) => entry.addOn.isActive)
        .map((entry) => ({ addOnId: entry.addOn.id, quantity: entry.quantity }));
      dropped = [
        ...line.options.filter((option) => !option.productOption.isActive).map((option) => option.productOption.name),
        ...line.addOns.filter((entry) => !entry.addOn.isActive).map((entry) => entry.addOn.name),
      ];
    } else {
      const resolved = resolveReplacementChain(line.productId, productById, targetSeason.id);
      if (resolved.productId) {
        mapping = {
          kind: "replacement",
          productId: resolved.productId,
          productName: productById.get(resolved.productId)!.name,
          chainNames: resolved.chain.map((id) => productById.get(id)?.name ?? "(deleted)"),
        };
      } else {
        const suggested = closestPricedProduct(line.unitPriceCents, candidates);
        mapping = { kind: "unmapped", suggestedProductId: suggested?.id ?? null };
      }
    }

    const recipient: RepeatRecipient = {
      name: line.recipientName,
      line1: line.addressLine1,
      line2: line.addressLine2,
      city: line.city,
      state: line.state,
      zip: line.zip,
    };
    const recipientValid = addressInputSchema.safeParse(toAddressInput(recipient)).success;

    return {
      lineId: line.id,
      originalProductName: line.product.name,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      greeting: line.greeting,
      recipient,
      recipientValid,
      mapping,
      dropped,
      carryOptionIds,
      carryAddOns,
    };
  });

  return {
    orderId: order.id,
    orderLabel: order.orderNumber ? `Order #${order.orderNumber}` : order.draftReference,
    sourceSeasonName: order.season.name,
    targetSeasonId: targetSeason.id,
    targetSeasonName: targetSeason.name,
    lines,
    candidates,
  };
}

function toAddressInput(recipient: RepeatRecipient) {
  return {
    recipient: recipient.name,
    line1: recipient.line1,
    line2: recipient.line2 ?? undefined,
    city: recipient.city,
    state: recipient.state,
    zip: recipient.zip,
  };
}

export type RepeatDecision = {
  lineId: string;
  /** null = remove this line from the repeat. */
  productId: string | null;
  /** false = carry the item without a recipient (assign later in the builder). */
  keepRecipient: boolean;
};

export type RepeatCartResult =
  | { ok: true; cartLines: CartLine[]; unassigned: number }
  | { ok: false; error: string };

/**
 * Turn confirmed decisions into builder cart lines. Every plan line needs a
 * decision; a kept line must resolve to an ACTIVE product in the target season
 * (the "picked or removed" rule for unmapped items). Recipients become
 * newRecipient assignments — draft save rewrites them into the customer's
 * address book (G-012).
 */
export function buildRepeatCartLines(plan: RepeatPlan, decisions: RepeatDecision[]): RepeatCartResult {
  const decisionByLine = new Map(decisions.map((decision) => [decision.lineId, decision]));
  const candidateIds = new Set(plan.candidates.map((candidate) => candidate.id));
  const cartLines: CartLine[] = [];
  let unassigned = 0;

  for (const line of plan.lines) {
    const decision = decisionByLine.get(line.lineId);
    if (!decision) {
      return { ok: false, error: `Missing a decision for "${line.originalProductName}" — pick a replacement or remove it` };
    }
    if (decision.productId === null) continue;
    if (!candidateIds.has(decision.productId)) {
      return {
        ok: false,
        error: `"${line.originalProductName}" needs a product that is available this season — pick a replacement or remove it`,
      };
    }

    const assignRecipient = decision.keepRecipient && line.recipientValid;
    if (!assignRecipient) unassigned += 1;
    // Options/add-ons only carry when the pick IS the original product.
    const keepsSameProduct = line.mapping.kind === "same" && decision.productId === line.mapping.productId;
    cartLines.push({
      id: randomUUID(),
      productId: decision.productId,
      quantity: line.quantity,
      optionIds: keepsSameProduct ? line.carryOptionIds : [],
      addOns: keepsSameProduct ? line.carryAddOns : [],
      greeting: line.greeting,
      assignment: assignRecipient
        ? { type: "newRecipient", address: addressInputSchema.parse(toAddressInput(line.recipient)) }
        : null,
    });
  }

  return { ok: true, cartLines, unassigned };
}

/**
 * Append repeat lines to whatever draft the owner already has — never clobber
 * in-progress work. Assignment rules run on the NEW lines only (existing
 * lines were ruled when they were saved); the address-book writes dedupe per
 * customer, so an optimistic-lock retry re-resolves to the same saved rows.
 * The draft write itself is atomic — see appendLinesToDraft.
 */
async function appendToDraft(
  seasonId: string,
  owner: DraftOwner,
  customerId: string,
  newLines: CartLine[],
  ifDraftExists: "append" | "skip" = "append"
) {
  const ruled = await applyAssignmentRules({ onOrderRecipient: null, lines: newLines } satisfies Cart, customerId);
  return appendLinesToDraft(seasonId, owner, ruled.lines, ifDraftExists);
}

export async function appendRepeatToCustomerDraft(seasonId: string, customerId: string, newLines: CartLine[]) {
  return appendToDraft(seasonId, { kind: "customer", customerId }, customerId, newLines);
}

export type StaffRepeatOutcome = {
  added: number;
  /** Lines that could not map to any product this season. */
  skipped: string[];
  /** Lines mapped by the price-smart fallback rather than an explicit replacement link. */
  suggested: string[];
  /** Set when ifDraftExists="skip" found an in-progress POS draft — nothing was written. */
  skippedExistingDraft?: boolean;
};

/**
 * Staff repeat (R-057/R-058): auto-map every line — same product, replacement
 * chain, else price-smart suggestion — and append to the customer's POS draft.
 * The POS builder is the staff review surface; unmappable lines are reported,
 * never guessed into the cart as dead products.
 */
export async function repeatOrderIntoPosDraft(
  order: RepeatableOrder,
  targetSeason: { id: string; name: string },
  options: { catalog?: CatalogProduct[]; ifDraftExists?: "append" | "skip" } = {}
): Promise<StaffRepeatOutcome> {
  const plan = await buildRepeatPlan(order, targetSeason, options.catalog);
  const skipped: string[] = [];
  const suggested: string[] = [];
  const decisions: RepeatDecision[] = plan.lines.map((line) => {
    if (line.mapping.kind !== "unmapped") {
      return { lineId: line.lineId, productId: line.mapping.productId, keepRecipient: true };
    }
    if (line.mapping.suggestedProductId) {
      suggested.push(line.originalProductName);
      return { lineId: line.lineId, productId: line.mapping.suggestedProductId, keepRecipient: true };
    }
    skipped.push(line.originalProductName);
    return { lineId: line.lineId, productId: null, keepRecipient: true };
  });

  const built = buildRepeatCartLines(plan, decisions);
  if (!built.ok) throw new Error(built.error);
  if (built.cartLines.length > 0) {
    const appended = await appendToDraft(
      targetSeason.id,
      posDraftOwner(order.customerId),
      order.customerId,
      built.cartLines,
      options.ifDraftExists ?? "append"
    );
    if (!appended.appended) return { added: 0, skipped, suggested, skippedExistingDraft: true };
  }
  return { added: built.cartLines.length, skipped, suggested };
}
