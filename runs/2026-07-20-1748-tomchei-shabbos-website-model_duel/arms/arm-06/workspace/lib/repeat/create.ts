/**
 * P10 (UR-008 / G-012): turn a CONFIRMED repeat review into a draft.
 *
 * The review page sends decisions only (keep / remove / swap-to-product) —
 * the plan is rebuilt server-side and the P4 draft engine re-snapshots every
 * price from the catalog, so nothing client-sent is trusted (R-149/R-150).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { buildRepeatPlan, RepeatReviewPlan } from "@/lib/repeat/plan";
import { DraftLineInput } from "@/lib/orders/resolve-lines";
import { DraftRecipientInput, DraftWithContents, saveDraft } from "@/lib/orders/drafts";

export interface RepeatConfirmLine {
  sourceLineId: string;
  action: "keep" | "remove" | "swap";
  /** Required on swap: the open-season product the customer picked. */
  targetProductId?: string;
  qty?: number;
}

export interface RepeatConfirmRecipient {
  sourceRecipientId: string;
  action: "keep" | "remove";
  /** Editable on the review page; defaults to the plan's prefill. */
  greeting?: string;
}

export interface RepeatConfirmInput {
  sourceOrderId: string;
  lines: RepeatConfirmLine[];
  recipients: RepeatConfirmRecipient[];
}

export interface RepeatDraftSummary {
  kept: string[];
  swapped: { from: string; to: string }[];
  removed: string[];
}

export interface RepeatDraftResult {
  draft: DraftWithContents;
  summary: RepeatDraftSummary;
}

/** Map confirm decisions onto a freshly rebuilt plan; throws on any mismatch. */
export function applyConfirmations(
  plan: RepeatReviewPlan,
  input: RepeatConfirmInput,
): { lines: DraftLineInput[]; recipients: DraftRecipientInput[]; summary: RepeatDraftSummary } {
  const summary: RepeatDraftSummary = { kept: [], swapped: [], removed: [] };

  const recipientDecisions = new Map(input.recipients.map((r) => [r.sourceRecipientId, r]));
  const keptRecipients = plan.recipients.filter(
    (r) => (recipientDecisions.get(r.sourceRecipientId)?.action ?? "keep") === "keep",
  );
  const keptRecipientIds = new Set(keptRecipients.map((r) => r.sourceRecipientId));

  const recipients: DraftRecipientInput[] = keptRecipients.map((r) => ({
    // Source row ids become client ids so lines map back one-to-one (P6 pattern).
    clientId: r.sourceRecipientId,
    name: r.name,
    line1: r.line1,
    line2: r.line2,
    city: r.city,
    region: r.region,
    postalCode: r.postalCode,
    country: r.country,
    addressId: r.matchedAddressId,
    saveToBook: false,
    greeting: recipientDecisions.get(r.sourceRecipientId)?.greeting ?? r.greeting,
  }));

  const lineDecisions = new Map(input.lines.map((l) => [l.sourceLineId, l]));
  const freshLineIds = new Map<string, string>();
  const productInputs: DraftLineInput[] = [];
  const addOnInputs: DraftLineInput[] = [];

  for (const planLine of plan.lines) {
    const decision = lineDecisions.get(planLine.sourceLineId);
    // Auto lines default to keep; an UNMAPPED line needs an explicit
    // swap-or-remove decision — an absent decision is neither (UR-008).
    const action = decision?.action ?? (planLine.status === "auto" ? "keep" : undefined);
    if (!action) {
      throw new DomainRuleError(
        `"${planLine.sourceName}" is discontinued — pick a replacement or remove it`,
      );
    }

    if (action === "remove") {
      summary.removed.push(planLine.sourceName);
      continue;
    }
    if (planLine.status === "unmapped" && action !== "swap") {
      throw new DomainRuleError(
        `"${planLine.sourceName}" is discontinued — pick a replacement or remove it`,
      );
    }

    let targetProductId = planLine.targetProductId;
    let optionValueId = planLine.optionValueId;
    if (action === "swap") {
      if (!decision?.targetProductId) {
        throw new DomainRuleError(`Swap of "${planLine.sourceName}" is missing its replacement product`);
      }
      targetProductId = decision.targetProductId;
      optionValueId = null; // source option rarely survives a manual swap; engine validates
      summary.swapped.push({ from: planLine.sourceName, to: targetProductId });
    } else {
      summary.kept.push(planLine.sourceName);
    }

    const qty = decision?.qty ?? planLine.qty;
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new DomainRuleError(`qty for "${planLine.sourceName}" must be a positive integer`);
    }
    // A line whose recipient was removed becomes unassigned — the checkout
    // flow re-prompts assignment instead of silently dropping the gift.
    const recipientClientId =
      planLine.sourceRecipientId && keptRecipientIds.has(planLine.sourceRecipientId)
        ? planLine.sourceRecipientId
        : null;

    const freshId = crypto.randomUUID();
    freshLineIds.set(planLine.sourceLineId, freshId);
    productInputs.push({
      id: freshId,
      productId: targetProductId!,
      optionValueId: optionValueId ?? undefined,
      qty,
      recipientClientId,
    });

    for (const addOn of planLine.addOns) {
      if (addOn.status !== "auto" || !addOn.addOnId) continue;
      addOnInputs.push({
        addOnId: addOn.addOnId,
        parentLineId: freshId,
        qty: addOn.qty,
      });
    }
  }

  if (productInputs.length === 0) {
    throw new DomainRuleError("Nothing to repeat — every line was removed");
  }
  return { lines: [...productInputs, ...addOnInputs], recipients, summary };
}

/**
 * Staff one-click path (P6 upgrade): keep every chain-resolved line as-is,
 * drop unmapped lines with reasons. Returns the skips so the caller can
 * surface "3 items repeated, 1 discontinued" without a review round-trip.
 */
export function autoConfirmPlan(plan: RepeatReviewPlan): RepeatConfirmInput {
  return {
    sourceOrderId: plan.sourceOrderId,
    lines: plan.lines.map((line) => ({
      sourceLineId: line.sourceLineId,
      action: line.status === "auto" ? "keep" : "remove",
    })),
    recipients: plan.recipients.map((r) => ({ sourceRecipientId: r.sourceRecipientId, action: "keep" })),
  };
}

/**
 * Confirm decisions → draft. Server-side callers that already hold a plan
 * (one-click, bulk history) pass it in so the N+1 chain walk runs once per
 * order; the client confirm route omits it and the plan is rebuilt here —
 * nothing client-sent is trusted (R-149/R-150).
 */
export async function createDraftFromRepeat(
  input: RepeatConfirmInput,
  builtPlan?: RepeatReviewPlan,
): Promise<RepeatDraftResult> {
  const source = await prisma.order.findUnique({
    where: { id: input.sourceOrderId },
    select: { id: true, customerId: true },
  });
  if (!source) throw new NotFoundError("Order", input.sourceOrderId);
  if (builtPlan && builtPlan.sourceOrderId !== input.sourceOrderId) {
    throw new DomainRuleError("The plan belongs to a different source order");
  }

  const plan = builtPlan ?? (await buildRepeatPlan(input.sourceOrderId));
  const { lines, recipients, summary } = applyConfirmations(plan, input);

  // Swap display names: report the catalog name, not the raw id.
  if (summary.swapped.length > 0) {
    const targets = await prisma.product.findMany({
      where: { id: { in: summary.swapped.map((s) => s.to) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(targets.map((t) => [t.id, t.name]));
    for (const swap of summary.swapped) swap.to = nameById.get(swap.to) ?? swap.to;
  }

  let draft: DraftWithContents;
  try {
    draft = await saveDraft({
      seasonId: plan.targetSeasonId,
      customerId: source.customerId,
      lines,
      recipients,
      allowBookWrites: false,
      repeatedFromOrderId: source.id,
    });
  } catch (error) {
    // The repeat-lineage unique index settles concurrent repeats: the loser
    // gets the same "already repeated" outcome the bulk skip reports.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      String((error.meta as { target?: unknown } | undefined)?.target ?? "").includes("repeatedFromOrderId")
    ) {
      throw new DomainRuleError("Order was already repeated into the open season");
    }
    throw error;
  }
  return { draft, summary };
}
