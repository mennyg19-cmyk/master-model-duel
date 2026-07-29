/**
 * P10 (UR-008 / R-057): build the repeat REVIEW plan for one source order
 * into the open season. Every source line is resolved through its
 * replacement chain (lib/repeat/chain); dead ends come back with price-smart
 * suggestions (lib/repeat/matcher) and must be explicitly picked or removed
 * on the review page — repeat never silently swaps or drops a product line.
 *
 * Pure read + shaping: nothing is persisted here. lib/repeat/create.ts turns
 * a confirmed plan into a draft via the P4 engine (which re-snapshots all
 * prices from the catalog, so the plan's prices are display-only).
 */
import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { getOpenSeason } from "@/lib/seasons/queries";
import { resolveReplacementChain } from "@/lib/repeat/chain";
import { suggestByPrice, PriceSuggestion } from "@/lib/repeat/matcher";
import { addressDedupeKey } from "@/lib/customers/addresses";

export interface RepeatPlanAddOn {
  sourceLineId: string;
  sourceName: string;
  qty: number;
  status: "auto" | "dropped";
  addOnId: string | null;
  unitPriceCents: number | null;
  note: string | null;
}

export interface RepeatPlanLine {
  sourceLineId: string;
  sourceName: string;
  sourceUnitPriceCents: number;
  sourceOptionLabel: string | null;
  qty: number;
  /** Source DraftRecipient row id this line was assigned to (null = unassigned). */
  sourceRecipientId: string | null;
  status: "auto" | "unmapped";
  targetProductId: string | null;
  targetName: string | null;
  targetUnitPriceCents: number | null;
  optionValueId: string | null;
  optionLabel: string | null;
  notes: string[];
  suggestions?: PriceSuggestion[];
  addOns: RepeatPlanAddOn[];
}

export interface RepeatPlanRecipient {
  sourceRecipientId: string;
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  /** Address-book row this recipient matches (kept as a book link in the new draft). */
  matchedAddressId: string | null;
  /** Prefilled greeting: book lastGreeting beats the source order's text (G-012). */
  greeting: string;
}

export interface RepeatReviewPlan {
  sourceOrderId: string;
  sourceOrderNumber: number | null;
  sourceSeasonName: string;
  targetSeasonId: string;
  targetSeasonName: string;
  lines: RepeatPlanLine[];
  recipients: RepeatPlanRecipient[];
  unmappedCount: number;
}

async function loadSourceOrder(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      season: { select: { name: true } },
      lines: true,
      recipients: true,
    },
  });
}

/** Map a source option pick onto the replacement product by option/value name. */
async function mapOption(
  sourceOptionValueId: string,
  targetProductId: string,
): Promise<{ optionValueId: string; optionLabel: string } | { dropped: string }> {
  const sourceValue = await prisma.productOptionValue.findUnique({
    where: { id: sourceOptionValueId },
    include: { option: true },
  });
  if (!sourceValue) return { dropped: "its option no longer exists" };
  const targetOption = await prisma.productOption.findFirst({
    where: { productId: targetProductId, name: sourceValue.option.name },
    include: { values: true },
  });
  const targetValue = targetOption?.values.find((value) => value.label === sourceValue.label);
  if (!targetOption || !targetValue) {
    return { dropped: `option "${sourceValue.option.name}: ${sourceValue.label}" isn't offered on the replacement` };
  }
  return { optionValueId: targetValue.id, optionLabel: `${targetOption.name}: ${targetValue.label}` };
}

/** Match a source add-on line to an active add-on allowed on the replacement product, by name. */
async function mapAddOn(
  sourceAddOnId: string,
  targetProductId: string,
): Promise<{ addOnId: string; unitPriceCents: number } | null> {
  const sourceAddOn = await prisma.addOn.findUnique({ where: { id: sourceAddOnId } });
  if (!sourceAddOn) return null;
  const restriction = await prisma.productAddOn.findFirst({
    where: { productId: targetProductId, addOn: { name: sourceAddOn.name, active: true } },
    include: { addOn: true },
  });
  return restriction ? { addOnId: restriction.addOn.id, unitPriceCents: restriction.addOn.priceCents } : null;
}

export async function buildRepeatPlan(orderId: string): Promise<RepeatReviewPlan> {
  const order = await loadSourceOrder(orderId);
  if (!order) throw new NotFoundError("Order", orderId);
  // One gate for all three entry points (customer/staff review, one-click):
  // only a finalized order is repeatable — repeating an in-progress draft
  // would clone an unfinished cart.
  if (order.status !== "FINALIZED") {
    throw new DomainRuleError(`Order is ${order.status}; expected FINALIZED to repeat`);
  }
  const season = await getOpenSeason();
  if (!season) throw new DomainRuleError("No open season to repeat the order into");

  // Address-book matches for greeting prefill + book links (one query).
  const book = await prisma.address.findMany({ where: { customerId: order.customerId } });
  const bookByKey = new Map(book.map((address) => [addressDedupeKey(address), address]));

  const recipients: RepeatPlanRecipient[] = order.recipients.map((recipient) => {
    const linked = recipient.addressId
      ? (book.find((address) => address.id === recipient.addressId) ?? null)
      : null;
    const matched = linked ?? bookByKey.get(addressDedupeKey(recipient)) ?? null;
    return {
      sourceRecipientId: recipient.id,
      name: recipient.name,
      line1: recipient.line1,
      line2: recipient.line2,
      city: recipient.city,
      region: recipient.region,
      postalCode: recipient.postalCode,
      country: recipient.country,
      matchedAddressId: matched?.id ?? null,
      greeting: matched?.lastGreeting ?? recipient.greeting ?? order.greetingDefault ?? "",
    };
  });

  const productLines = order.lines.filter((line) => line.productId);
  const addOnLines = order.lines.filter((line) => line.addOnId);

  const lines: RepeatPlanLine[] = [];
  for (const line of productLines) {
    const notes: string[] = [];
    const chain = await resolveReplacementChain(line.productId!, season.id);
    const children = addOnLines.filter((addOn) => addOn.parentLineId === line.id);

    if (!chain.final) {
      lines.push({
        sourceLineId: line.id,
        sourceName: line.productName,
        sourceUnitPriceCents: line.unitPriceCents,
        sourceOptionLabel: line.optionLabel,
        qty: line.qty,
        sourceRecipientId: line.recipientId,
        status: "unmapped",
        targetProductId: null,
        targetName: null,
        targetUnitPriceCents: null,
        optionValueId: null,
        optionLabel: null,
        notes: ["discontinued with no replacement mapped"],
        suggestions: await suggestByPrice(line.productId!, season.id),
        addOns: children.map((child) => ({
          sourceLineId: child.id,
          sourceName: child.productName,
          qty: child.qty,
          status: "dropped",
          addOnId: null,
          unitPriceCents: null,
          note: "parent line is unmapped",
        })),
      });
      continue;
    }

    let optionValueId: string | null = null;
    let optionLabel: string | null = null;
    if (line.optionValueId) {
      const mapped = await mapOption(line.optionValueId, chain.final.id);
      if ("dropped" in mapped) notes.push(mapped.dropped);
      else {
        optionValueId = mapped.optionValueId;
        optionLabel = mapped.optionLabel;
      }
    }

    const target = await prisma.product.findUnique({
      where: { id: chain.final.id },
      select: { basePriceCents: true },
    });
    const targetPrice = target?.basePriceCents ?? line.unitPriceCents;
    if (targetPrice !== line.unitPriceCents) {
      notes.push(
        `price is now $${(targetPrice / 100).toFixed(2)} (was $${(line.unitPriceCents / 100).toFixed(2)})`,
      );
    }

    const addOns: RepeatPlanAddOn[] = [];
    for (const child of children) {
      const mapped = await mapAddOn(child.addOnId!, chain.final.id);
      if (mapped) {
        addOns.push({
          sourceLineId: child.id,
          sourceName: child.productName,
          qty: child.qty,
          status: "auto",
          addOnId: mapped.addOnId,
          unitPriceCents: mapped.unitPriceCents,
          note:
            mapped.unitPriceCents !== child.unitPriceCents
              ? `price is now $${(mapped.unitPriceCents / 100).toFixed(2)} (was $${(child.unitPriceCents / 100).toFixed(2)})`
              : null,
        });
      } else {
        addOns.push({
          sourceLineId: child.id,
          sourceName: child.productName,
          qty: child.qty,
          status: "dropped",
          addOnId: null,
          unitPriceCents: null,
          note: "not offered on the replacement",
        });
      }
    }

    lines.push({
      sourceLineId: line.id,
      sourceName: line.productName,
      sourceUnitPriceCents: line.unitPriceCents,
      sourceOptionLabel: line.optionLabel,
      qty: line.qty,
      sourceRecipientId: line.recipientId,
      status: "auto",
      targetProductId: chain.final.id,
      targetName: chain.final.name,
      targetUnitPriceCents: targetPrice,
      optionValueId,
      optionLabel,
      notes,
      addOns,
    });
  }

  return {
    sourceOrderId: order.id,
    sourceOrderNumber: order.orderNumber,
    sourceSeasonName: order.season.name,
    targetSeasonId: season.id,
    targetSeasonName: season.name,
    lines,
    recipients,
    unmappedCount: lines.filter((line) => line.status === "unmapped").length,
  };
}
