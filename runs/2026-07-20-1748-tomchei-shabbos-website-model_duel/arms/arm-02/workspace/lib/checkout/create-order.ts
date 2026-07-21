import { db } from "@/lib/db";
import { newDraftReference } from "@/lib/domain/draft-reference";
import { findOrLinkCustomer } from "@/lib/customers";
import type { Cart } from "@/lib/order-builder/cart";
import { buildCheckoutQuote } from "@/lib/checkout/quote";
import { assignmentKey, type CheckoutRecipient } from "@/lib/checkout/recipients";
import type { MethodChoice } from "@/lib/checkout/fees";

export type CheckoutInput = {
  cart: Cart;
  customerId: string | null;
  /** Guest checkouts must give contact details to become the order's customer. */
  guestContact: { email: string; name: string; phone?: string } | null;
  choices: MethodChoice[];
  deliveryDay: string | null;
  greetingDefault: string;
  greetingOverrides: { recipientKey: string; greeting: string }[];
  donationCents: number;
  expectedTotalCents: number;
  sourceDraftId: string;
};

export type CheckoutConflict = {
  kind: "conflict";
  errors: string[];
  freshTotalCents: number | null;
};

export type CheckoutSuccess = {
  kind: "created";
  orderId: string;
  draftReference: string;
  totalCents: number;
};

/**
 * Converts a builder draft into a real DRAFT Order with full price snapshots
 * (R-149): unit prices, option adjustments, add-on prices, fees, and donation
 * are all re-derived from the DB at this moment and frozen onto the order.
 * Stock is NOT reserved here — reservation happens inside finalizeOrder once
 * payment succeeds, so an abandoned Stripe session never holds inventory.
 *
 * Stale carts are refused (R-034, R-037): any line issue (price change is
 * caught by the total comparison; stock shortfalls and dead products/options
 * by priceCart) or an expectedTotal mismatch returns a conflict, never an order.
 */
export async function createOrderFromCart(input: CheckoutInput): Promise<CheckoutConflict | CheckoutSuccess> {
  const season = await db.season.findFirst({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" } });
  if (!season) return { kind: "conflict", errors: ["The store is closed"], freshTotalCents: null };

  const quote = await buildCheckoutQuote(
    season.id,
    input.cart,
    input.customerId,
    input.choices,
    input.deliveryDay
  );
  if ("error" in quote) return { kind: "conflict", errors: [quote.error], freshTotalCents: null };

  const issueMessages = [
    ...quote.priced.issues,
    ...quote.priced.lines.flatMap((line) => line.issues.map((issue) => `${line.productName}: ${issue}`)),
  ];
  if (issueMessages.length > 0) {
    return { kind: "conflict", errors: issueMessages, freshTotalCents: null };
  }
  if (!quote.fees || !quote.fees.ok) {
    return {
      kind: "conflict",
      errors: quote.fees && !quote.fees.ok ? quote.fees.errors : ["Delivery choices are incomplete"],
      freshTotalCents: null,
    };
  }

  const itemsCents = quote.priced.totalCents;
  const donationCents = input.donationCents;
  const totalCents = itemsCents + quote.fees.feesCents + donationCents;
  if (totalCents !== input.expectedTotalCents) {
    return {
      kind: "conflict",
      errors: ["Prices or fees changed while you were checking out — review the updated total"],
      freshTotalCents: totalCents,
    };
  }
  if (totalCents <= 0) {
    return { kind: "conflict", errors: ["Order total must be positive"], freshTotalCents: totalCents };
  }

  // The order needs a customer row. Guests get find-or-create by email (their
  // record exists for staff lookup even before they ever register).
  let customerId = input.customerId;
  if (!customerId) {
    if (!input.guestContact) {
      return { kind: "conflict", errors: ["Enter your name and email to place the order"], freshTotalCents: null };
    }
    const customer = await findOrLinkCustomer(input.guestContact);
    customerId = customer.id;
  }

  const overrideByKey = new Map(input.greetingOverrides.map((entry) => [entry.recipientKey, entry.greeting]));
  const methodByKey = new Map(input.choices.map((choice) => [choice.recipientKey, choice.methodId]));
  const recipientByKey = new Map(quote.recipients.map((recipient) => [recipient.key, recipient]));
  const pricedById = new Map(quote.priced.lines.map((line) => [line.id, line]));

  const greetingFor = (recipient: CheckoutRecipient): string => {
    const override = overrideByKey.get(recipient.key)?.trim();
    if (override) return override;
    return input.greetingDefault.trim();
  };

  // Real per-part snapshots for option/add-on rows (R-149) — priceCart folded
  // these into line totals; the order keeps the parts for later refunds/edits.
  const optionIds = [...new Set(input.cart.lines.flatMap((line) => line.optionIds))];
  const addOnIds = [...new Set(input.cart.lines.flatMap((line) => line.addOns.map((entry) => entry.addOnId)))];
  const [optionRows, addOnRows] = await Promise.all([
    optionIds.length ? db.productOption.findMany({ where: { id: { in: optionIds } } }) : [],
    addOnIds.length ? db.addOn.findMany({ where: { id: { in: addOnIds } } }) : [],
  ]);
  const optionById = new Map(optionRows.map((row) => [row.id, row]));
  const addOnById = new Map(addOnRows.map((row) => [row.id, row]));

  const order = await db.$transaction(async (tx) => {
    // One draft = one live order: a prior attempt (abandoned Stripe session)
    // for the same builder draft is discarded and replaced, so retries can't
    // stack up payable duplicates.
    const stale = await tx.order.findFirst({
      where: { sourceDraftId: input.sourceDraftId, status: "DRAFT" },
    });
    if (stale) {
      await tx.order.update({
        where: { id: stale.id },
        data: { status: "DISCARDED", discardedAt: new Date() },
      });
      await tx.stripeCheckoutSession.updateMany({
        where: { orderId: stale.id, status: "open" },
        data: { status: "replaced" },
      });
    }

    const created = await tx.order.create({
      data: {
        seasonId: season.id,
        customerId: customerId!,
        draftReference: newDraftReference(),
        itemsCents,
        feesCents: quote.fees!.ok ? quote.fees!.feesCents : 0,
        donationCents,
        totalCents,
        feeBreakdown: quote.fees!.ok ? quote.fees!.feeLines : undefined,
        greetingDefault: input.greetingDefault.trim(),
        deliveryDay: input.deliveryDay,
        sourceDraftId: input.sourceDraftId,
      },
    });

    // Anchor the customer-paid shipping quotes to this order (M4/M6): label
    // purchase records THIS charge, not a fresh label-time re-quote.
    const paidQuoteIds = quote.fees!.ok
      ? quote.fees!.feeLines.map((line) => line.quoteId).filter((id): id is string => Boolean(id))
      : [];
    if (paidQuoteIds.length > 0) {
      await tx.shippingQuote.updateMany({
        where: { id: { in: paidQuoteIds } },
        data: { orderId: created.id },
      });
    }

    for (const line of input.cart.lines) {
      const priced = pricedById.get(line.id);
      const recipient = recipientByKey.get(assignmentKey(line.assignment!));
      const methodId = recipient ? methodByKey.get(recipient.key) : undefined;
      if (!priced || !recipient || !methodId) {
        throw new Error(`Checkout line ${line.id} lost its pricing or recipient mid-transaction`);
      }

      await tx.orderLine.create({
        data: {
          orderId: created.id,
          productId: line.productId,
          quantity: line.quantity,
          unitPriceCents: priced.unitPriceCents,
          recipientName: recipient.recipientName,
          addressLine1: recipient.address.line1,
          addressLine2: recipient.address.line2,
          city: recipient.address.city,
          state: recipient.address.state,
          zip: recipient.address.zip,
          fulfillmentMethodId: methodId,
          greeting: greetingFor(recipient),
          options: {
            create: line.optionIds.map((optionId) => ({
              productOptionId: optionId,
              priceAdjustmentCents: optionById.get(optionId)?.priceAdjustmentCents ?? 0,
            })),
          },
          addOns: {
            create: line.addOns.map((entry) => ({
              addOnId: entry.addOnId,
              quantity: entry.quantity,
              unitPriceCents: addOnById.get(entry.addOnId)?.priceCents ?? 0,
            })),
          },
        },
      });
    }

    // Greeting memory (UR-013, G-020): remember what each saved recipient got
    // so next season's checkout can prefill it.
    for (const recipient of quote.recipients) {
      const greeting = greetingFor(recipient);
      if (recipient.addressBookId && greeting) {
        await tx.customerAddress.update({
          where: { id: recipient.addressBookId },
          data: { lastGreeting: greeting },
        });
      }
    }

    return created;
  });

  return { kind: "created", orderId: order.id, draftReference: order.draftReference, totalCents };
}
