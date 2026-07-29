import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { getOpenSeason } from "@/lib/seasons/queries";
import { DraftLineInput } from "@/lib/orders/resolve-lines";
import { DraftRecipientInput, DraftWithContents, saveDraft } from "@/lib/orders/drafts";

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
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { lines: true, recipients: true },
  });
  if (!order) throw new NotFoundError("Order", orderId);
  if (order.status !== "FINALIZED") {
    throw new DomainRuleError(`Order ${orderId} is ${order.status}; expected FINALIZED to repeat`);
  }
  const season = await getOpenSeason();
  if (!season) throw new DomainRuleError("No open season to repeat the order into");

  const products = await prisma.product.findMany({
    where: { seasonId: season.id, active: true },
    include: { options: { include: { values: true } }, allowedAddOns: { include: { addOn: true } } },
  });
  const plan = planRepeat(order, {
    productIds: new Set(products.map((product) => product.id)),
    optionValueIds: new Set(
      products.flatMap((product) => product.options.flatMap((option) => option.values.map((value) => value.id))),
    ),
    addOnIds: new Set(
      products
        .flatMap((product) => product.allowedAddOns.map((restriction) => restriction.addOn))
        .filter((addOn) => addOn.active)
        .map((addOn) => addOn.id),
    ),
  });
  if (plan.lines.length === 0) {
    throw new DomainRuleError("Nothing to repeat — every line is gone from the active catalog");
  }

  const draft = await saveDraft({
    seasonId: season.id,
    customerId: order.customerId,
    lines: plan.lines,
    recipients: plan.recipients,
    allowBookWrites: false,
  });
  return { draftRef: draft.draftRef!, skipped: plan.skipped };
}
