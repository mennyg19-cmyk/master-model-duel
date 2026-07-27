import 'server-only';

import type { Prisma } from '@prisma/client';

import { failure, ok, type Failure, type Result } from '../core/result';
import { REPEAT_NOTHING_TO_COPY, type RepeatLinePlan, type RepeatPlan } from './repeat-plan';
import { addressColumnsFromSaved } from './repeat-recipients';

/**
 * Turning a repeat plan into a draft (UR-007, R-057).
 *
 * The plan is the read model and this is the write: the caller supplies one
 * decision per line — the customer's own from the review page, or the automatic
 * ones the counter uses — and nothing is inferred here beyond which product row
 * to snapshot.
 */
export const REPEAT_NEEDS_DECISION = 'repeat_needs_decision';
export const REPEAT_UNKNOWN_CHOICE = 'repeat_unknown_choice';

/**
 * What the customer decided on the review page, one entry per planned line.
 *
 * `productId` is empty only for a line the plan could not resolve, and applying
 * refuses in that case: an unmapped item is picked or removed, never quietly
 * dropped (UR-007).
 */
export type RepeatDecision = {
  sourceLineId: string;
  productId: string;
  removed: boolean;
  customerAddressId: string | null;
};

type OnSaleProduct = { id: string; name: string; priceCents: number };

export type AppliedRepeat = {
  draftId: string;
  draftReference: string;
  customerId: string;
  copiedLines: number;
  swappedLines: number;
  removedLines: number;
};

/**
 * The first line nobody has answered for, phrased as the refusal.
 *
 * Both the writer below and the customer's confirm ask this, and the confirm
 * asks it first: the review page puts the items above the recipients, so a form
 * with an undecided item and an unhoused recipient should complain about the
 * item, in the order the page reads.
 */
export function undecidedLineFailure(
  plan: RepeatPlan,
  decisions: Map<string, RepeatDecision>,
): Failure | null {
  const line = plan.lines.find((candidate) => {
    const decision = decisions.get(candidate.sourceLineId);
    return !decision || (decision.productId === '' && !decision.removed);
  });

  return line
    ? failure(
        REPEAT_NEEDS_DECISION,
        `Choose what to do about "${line.sourceName}": pick this year's item or take it off.`,
      )
    : null;
}

/**
 * Writes the plan out as a draft in one transaction, with this season's prices.
 *
 * Every chosen product is re-read inside that transaction rather than trusted
 * from the plan: the review page may have been open while the office retired an
 * item, and a draft built from a stale catalogue is a box that cannot be packed.
 * A line whose decision is missing is a bug in the screen, not a line to guess
 * at, so it is refused by name.
 */
export async function applyRepeatPlan(
  plan: RepeatPlan,
  decisions: Map<string, RepeatDecision>,
  draftData: Prisma.OrderUncheckedCreateInput,
  client: Prisma.TransactionClient,
): Promise<Result<AppliedRepeat>> {
  const undecided = undecidedLineFailure(plan, decisions);
  if (undecided) return undecided;

  const addressIds = new Set(plan.addressBook.map((address) => address.id));
  const chosen: { line: RepeatLinePlan; productId: string; addressId: string | null }[] = [];
  let removedLines = 0;

  for (const line of plan.lines) {
    const decision = decisions.get(line.sourceLineId);

    // Unreachable: every line has a decision or the refusal above returned.
    if (!decision) continue;

    if (decision.removed) {
      removedLines += 1;
      continue;
    }
    if (decision.customerAddressId !== null && !addressIds.has(decision.customerAddressId)) {
      return failure(REPEAT_UNKNOWN_CHOICE, `That address is not in ${line.recipient.name}'s book any more.`);
    }

    chosen.push({ line, productId: decision.productId, addressId: decision.customerAddressId });
  }

  if (chosen.length === 0) {
    return failure(REPEAT_NOTHING_TO_COPY, 'Everything was taken off, so there is nothing to repeat.');
  }

  const onSale = new Map(
    (
      await client.product.findMany({
        where: {
          id: { in: [...new Set(chosen.map((write) => write.productId))] },
          seasonId: plan.targetSeasonId,
          isActive: true,
        },
        select: { id: true, name: true, priceCents: true },
      })
    ).map((product) => [product.id, product]),
  );

  const savedAddresses = new Map(
    (
      await client.customerAddress.findMany({
        where: { id: { in: chosen.flatMap((write) => (write.addressId ? [write.addressId] : [])) } },
      })
    ).map((address) => [address.id, address]),
  );

  const writes: { line: RepeatLinePlan; product: OnSaleProduct; addressId: string | null }[] = [];
  let swappedLines = 0;

  for (const { line, productId, addressId } of chosen) {
    const product = onSale.get(productId);
    if (!product) {
      return failure(REPEAT_UNKNOWN_CHOICE, `"${line.sourceName}" was swapped for something that is not on sale.`);
    }
    if (product.id !== line.product?.id) swappedLines += 1;

    writes.push({ line, product, addressId });
  }

  const draft = await client.order.create({ data: draftData });

  for (const { line, product, addressId } of writes) {
    const saved = addressId === null ? undefined : savedAddresses.get(addressId);
    const recipient = saved
      ? {
          ...line.recipient,
          name: saved.recipientName,
          customerAddressId: saved.id,
          address: addressColumnsFromSaved(saved),
        }
      : line.recipient;

    await client.orderLine.create({
      data: {
        orderId: draft.id,
        productId: product.id,
        quantity: line.quantity,
        productNameSnapshot: product.name,
        unitPriceCents: product.priceCents,
        lineTotalCents: product.priceCents * line.quantity,
        recipientName: recipient.methodId === null ? null : recipient.name,
        fulfillmentMethodId: recipient.methodId,
        pickupLocationId: recipient.pickupLocationId,
        customerAddressId: recipient.customerAddressId,
        ...recipient.address,
        greetingMessage: line.greetingMessage,
        addOns: {
          create: line.addOns.map((addOn) => ({
            addOnId: addOn.id,
            quantity: 1,
            addOnNameSnapshot: addOn.name,
            unitPriceCents: addOn.priceCents,
            lineTotalCents: addOn.priceCents,
          })),
        },
      },
    });
  }

  return ok({
    draftId: draft.id,
    draftReference: draft.draftReference,
    customerId: plan.customerId,
    copiedLines: chosen.length,
    swappedLines,
    removedLines,
  });
}

/**
 * What a repeat does when nobody is standing at the screen to decide.
 *
 * Anything the plan resolved is kept as it resolved; anything it could not is
 * taken off and reported by name. That is the staff-facing contract (R-057):
 * the cart lands on the till with the swaps already made and a note about what
 * needs talking through, rather than silently short.
 */
export function autoDecisions(plan: RepeatPlan): Map<string, RepeatDecision> {
  return new Map(
    plan.lines.map((line) => [
      line.sourceLineId,
      {
        sourceLineId: line.sourceLineId,
        productId: line.product?.id ?? '',
        removed: line.product === null,
        customerAddressId: null,
      },
    ]),
  );
}

export function unresolvedNames(plan: RepeatPlan): string[] {
  return [...new Set(plan.lines.filter((line) => line.product === null).map((line) => line.sourceName))];
}
