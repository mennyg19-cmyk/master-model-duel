import { prisma } from "@/lib/db";
import { DomainRuleError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { DraftAccess } from "@/lib/orders/drafts";
import { reserveStockTx } from "@/lib/inventory/reserve";
import { getStripeConfig } from "@/lib/payments/stripe";
import { quoteRecipientShipping } from "@/lib/checkout/shipping-quotes";
import {
  bulkAddressKey,
  CheckoutSubmitInput,
  effectiveGreeting,
  normalizeGreeting,
  resolveDeliveryFeeCents,
  validateFulfillmentChoice,
} from "@/lib/checkout/fulfillment";
import { CheckoutConflictError, repriceAndCheckStock } from "@/lib/checkout/validate";
import { inventoryNeedsForLines, releaseOrderReservation } from "@/lib/checkout/reservations";
import { loadAccessibleOrder } from "@/lib/checkout/order-load";

// R-127 refusal raised when a public caller asks for an offline method.
export class OfflinePaymentForbiddenError extends Error {
  constructor() {
    super("Cash, check, and comp payments are staff-only (POS)");
    this.name = "OfflinePaymentForbiddenError";
  }
}

export interface CheckoutSummary {
  draftRef: string;
  subtotalCents: number;
  deliveryFeesCents: number;
  totalCents: number;
  stripeConfigured: boolean;
  recipients: {
    recipientId: string;
    name: string;
    fulfillmentChoice: string;
    deliveryDay: string | null;
    deliveryFeeCents: number;
    effectiveGreeting: string | null;
  }[];
}

// First half of checkout (R-034/R-037, UR-009/013): validate the draft
// against the live catalog, freeze fulfillment choices + greetings + fee
// snapshots, and reserve stock. Stripe-independent, so every safety property
// of checkout is exercised before a session exists.
export async function submitCheckout(
  input: CheckoutSubmitInput,
  access: DraftAccess,
): Promise<CheckoutSummary | null> {
  // R-127: offline methods stay staff-only (POS) — the staff flag is only
  // constructible server-side behind requirePermission("payments.manage").
  if (input.method !== "card" && !access.staff) throw new OfflinePaymentForbiddenError();

  const [fees, deliveryDays, deliveryZips] = await Promise.all([
    getSetting("delivery.fees"),
    getSetting("delivery.days"),
    getSetting("shipping.deliveryZips"),
  ]);
  const feeRules = fees ?? { bulkPerDestinationCents: 0, perPackagePerRecipientCents: 0 };
  const days = deliveryDays ?? [];
  const zips = deliveryZips ?? [];

  return prisma.$transaction(async (tx) => {
    const order = await loadAccessibleOrder(tx, input.draftRef, access);
    if (!order) return null;
    if (order.status !== "DRAFT") {
      throw new DomainRuleError(`Order ${order.draftRef} is ${order.status}; expected DRAFT to check out`);
    }
    if (order.season.status !== "OPEN") {
      throw new DomainRuleError(`Season ${order.season.name} is closed; expected OPEN to check out`);
    }

    // Every line needs a recipient and every recipient a choice — a partial
    // submit can never freeze a fee snapshot.
    if (order.lines.length === 0) throw new DomainRuleError("The draft has no lines");
    const unassigned = order.lines.filter((line) => !line.recipientId);
    if (unassigned.length > 0) {
      throw new DomainRuleError(`${unassigned.length} line(s) are not assigned to a recipient yet`);
    }
    const choiceByRecipient = new Map(input.recipients.map((choice) => [choice.recipientId, choice]));
    for (const recipient of order.recipients) {
      if (!choiceByRecipient.has(recipient.id)) {
        throw new DomainRuleError(`Missing a fulfillment choice for ${recipient.name}`);
      }
    }
    for (const [recipientId] of choiceByRecipient) {
      if (!order.recipients.some((recipient) => recipient.id === recipientId)) {
        throw new DomainRuleError(`Unknown recipient on this draft: ${recipientId}`);
      }
    }

    const choiceErrors: string[] = [];
    for (const recipient of order.recipients) {
      const choice = choiceByRecipient.get(recipient.id)!;
      const verdict = validateFulfillmentChoice({
        choice: choice.fulfillmentChoice,
        postalCode: recipient.postalCode,
        deliveryDay: choice.deliveryDay,
        deliveryZips: zips,
        deliveryDays: days,
      });
      if (!verdict.ok) choiceErrors.push(`${recipient.name}: ${verdict.reason}`);
    }
    if (choiceErrors.length > 0) throw new DomainRuleError(choiceErrors.join("; "));

    // Re-submit idempotency: release the prior reservation so the order never
    // competes with its own held stock during revalidation.
    await releaseOrderReservation(tx, order.id);

    const { freshSubtotalCents, priceConflicts, stockIssues } = await repriceAndCheckStock(tx, order.lines);

    // G-015: bulk = one fee per destination address; per-package = one per
    // recipient; pickup = free; SHIPPED = live Shippo quote re-resolved at
    // submit (R-032) so a stale page lands a 409, never a wrong charge.
    const seenBulkAddresses = new Set<string>();
    const feeByRecipient = new Map<string, number>();
    for (const recipient of order.recipients) {
      const choice = choiceByRecipient.get(recipient.id)!;
      let feeCents = 0;
      if (choice.fulfillmentChoice === "SHIPPED") {
        try {
          const quote = await quoteRecipientShipping(tx, { orderId: order.id, recipient });
          feeCents = quote.chargedCents;
        } catch (error) {
          // A quote failure refuses the submit with a clean 422 (R-032) —
          // the frozen fee can never be a guess.
          if (error instanceof Error) throw new DomainRuleError(`${recipient.name}: ${error.message}`);
          throw error;
        }
      } else {
        feeCents = resolveDeliveryFeeCents(choice.fulfillmentChoice, feeRules);
      }
      if (choice.fulfillmentChoice === "BULK_DELIVERY") {
        const key = bulkAddressKey(recipient);
        if (seenBulkAddresses.has(key)) feeCents = 0;
        seenBulkAddresses.add(key);
      }
      feeByRecipient.set(recipient.id, feeCents);
    }
    const freshFeesCents = [...feeByRecipient.values()].reduce((sum, fee) => sum + fee, 0);
    const freshTotalCents = freshSubtotalCents + freshFeesCents;

    if (priceConflicts.length > 0 || stockIssues.length > 0 || freshTotalCents !== input.expectedTotalCents) {
      throw new CheckoutConflictError({
        priceConflicts,
        stockIssues,
        expectedTotalCents: input.expectedTotalCents,
        freshSubtotalCents,
        freshFeesCents,
        freshTotalCents,
      });
    }

    for (const recipient of order.recipients) {
      const choice = choiceByRecipient.get(recipient.id)!;
      await tx.draftRecipient.update({
        where: { id: recipient.id },
        data: {
          fulfillmentChoice: choice.fulfillmentChoice,
          deliveryDay: choice.fulfillmentChoice === "PER_PACKAGE_DELIVERY" ? (choice.deliveryDay ?? null) : null,
          deliveryFeeCents: feeByRecipient.get(recipient.id) ?? 0,
          greeting: normalizeGreeting(choice.greeting),
        },
      });
    }
    await tx.order.update({
      where: { id: order.id },
      data: {
        greetingDefault: normalizeGreeting(input.greetingDefault),
        deliveryFeesCents: freshFeesCents,
        totalCents: freshTotalCents,
        version: { increment: 1 },
      },
    });

    const needs = await inventoryNeedsForLines(tx, order.lines);
    for (const [itemId, qty] of needs) {
      await reserveStockTx(tx, itemId, qty);
    }
    await tx.order.update({ where: { id: order.id }, data: { stockReserved: true } });

    return {
      draftRef: order.draftRef!,
      subtotalCents: freshSubtotalCents,
      deliveryFeesCents: freshFeesCents,
      totalCents: freshTotalCents,
      stripeConfigured: getStripeConfig().secretKey !== null,
      recipients: order.recipients.map((recipient) => {
        const choice = choiceByRecipient.get(recipient.id)!;
        return {
          recipientId: recipient.id,
          name: recipient.name,
          fulfillmentChoice: choice.fulfillmentChoice,
          deliveryDay: choice.fulfillmentChoice === "PER_PACKAGE_DELIVERY" ? (choice.deliveryDay ?? null) : null,
          deliveryFeeCents: feeByRecipient.get(recipient.id) ?? 0,
          effectiveGreeting: effectiveGreeting(choice.greeting, input.greetingDefault),
        };
      }),
    };
  });
}
