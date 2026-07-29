import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { DraftLineInput } from "@/lib/orders/resolve-lines";
import { DraftRecipientInput, DraftWithContents } from "@/lib/orders/drafts";
import { buildRepeatPlan } from "@/lib/repeat/plan";
import { autoConfirmPlan, createDraftFromRepeat } from "@/lib/repeat/create";

// R-057 shell: staff single-order repeat. Straight copy into a new draft —
// discontinued lines are skipped with reasons; the replacement flow
// (replacedBy suggestions) is P10 scope, not here.
export interface RepeatSkip {
  productName: string;
  reason: string;
}

export interface RepeatPlan {
  lines: DraftLineInput[];
  recipients: DraftRecipientInput[];
  skipped: RepeatSkip[];
}

export interface RepeatCatalog {
  productIds: ReadonlySet<string>;
  optionValueIds: ReadonlySet<string>;
  addOnIds: ReadonlySet<string>;
}

export function planRepeat(order: DraftWithContents, catalog: RepeatCatalog): RepeatPlan {
  const recipients: DraftRecipientInput[] = order.recipients.map((recipient) => ({
    // Old row ids become the client ids so lines map back one-to-one.
    clientId: recipient.id,
    name: recipient.name,
    line1: recipient.line1,
    line2: recipient.line2,
    city: recipient.city,
    region: recipient.region,
    postalCode: recipient.postalCode,
    country: recipient.country,
    // Snapshot only: never re-link a book row or auto-save over one.
    saveToBook: false,
  }));

  const lines: DraftLineInput[] = [];
  const skipped: RepeatSkip[] = [];
  const skippedLineIds = new Set<string>();
  // Kept lines get FRESH ids — the old ones already exist as rows in the
  // source order, and add-ons re-point at their parent's fresh id.
  const freshLineIds = new Map<string, string>();

  for (const line of order.lines) {
    if (line.productId) {
      if (!catalog.productIds.has(line.productId)) {
        skipped.push({ productName: line.productName, reason: "no longer in the active catalog" });
        skippedLineIds.add(line.id);
        continue;
      }
      if (line.optionValueId && !catalog.optionValueIds.has(line.optionValueId)) {
        skipped.push({ productName: line.productName, reason: "its option is gone from the catalog" });
        skippedLineIds.add(line.id);
        continue;
      }
      const freshId = crypto.randomUUID();
      freshLineIds.set(line.id, freshId);
      lines.push({
        id: freshId,
        productId: line.productId,
        optionValueId: line.optionValueId ?? undefined,
        qty: line.qty,
        recipientClientId: line.recipientId ?? undefined,
      });
    } else if (line.addOnId) {
      if (line.parentLineId && skippedLineIds.has(line.parentLineId)) continue; // parent already reported
      if (!catalog.addOnIds.has(line.addOnId)) {
        skipped.push({ productName: line.productName, reason: "add-on no longer in the active catalog" });
        continue;
      }
      lines.push({
        addOnId: line.addOnId,
        parentLineId: line.parentLineId ? (freshLineIds.get(line.parentLineId) ?? undefined) : undefined,
        qty: line.qty,
      });
    }
  }
  return { lines, recipients, skipped };
}

export async function repeatOrder(orderId: string): Promise<{ draftRef: string; skipped: RepeatSkip[] }> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, status: true } });
  if (!order) throw new NotFoundError("Order", orderId);
  if (order.status !== "FINALIZED") {
    throw new DomainRuleError(`Order ${orderId} is ${order.status}; expected FINALIZED to repeat`);
  }

  // P10: one-click repeat now resolves replacement chains (R-057/R-058).
  // Lines whose chain dead-ends are reported as skips; everything else lands
  // in the new draft at current catalog prices.
  const plan = await buildRepeatPlan(orderId);
  const { draft } = await createDraftFromRepeat(autoConfirmPlan(plan));
  const skipped: RepeatSkip[] = plan.lines
    .filter((line) => line.status === "unmapped")
    .map((line) => ({ productName: line.sourceName, reason: "discontinued with no replacement mapped" }));
  return { draftRef: draft.draftRef!, skipped };
}
