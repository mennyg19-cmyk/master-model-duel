import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { priceCart, type Cart, type PricedCart } from "@/lib/order-builder/cart";
import { destinationKey, resolveCheckoutRecipients, type CheckoutRecipient } from "@/lib/checkout/recipients";
import { computeFees, type FeeResult, type FeeRuleConfig, type MethodChoice } from "@/lib/checkout/fees";
import { quoteShipping } from "@/lib/shipping/quotes";
import type { PackItem } from "@/lib/shipping/bin-packing";

export type CheckoutMethodOption = {
  id: string;
  code: string;
  name: string;
  kind: "BULK_DELIVERY" | "PER_PACKAGE_DELIVERY" | "SHIPPING" | "PICKUP";
};

export type CheckoutQuote = {
  priced: PricedCart;
  recipients: CheckoutRecipient[];
  methods: CheckoutMethodOption[];
  config: FeeRuleConfig;
  fees: FeeResult | null;
};

/** Cart + per-line issues flattened to one display list (POS and web quote routes). */
export function flattenQuoteIssues(priced: PricedCart): string[] {
  return [
    ...priced.issues,
    ...priced.lines.flatMap((line) => line.issues.map((issue) => `${line.productName}: ${issue}`)),
  ];
}

export async function loadFeeRuleConfig(): Promise<FeeRuleConfig> {
  const [rules, deliveryZips, purimDayChoices] = await Promise.all([
    getSetting("shipping.rules"),
    getSetting("shipping.delivery_zips"),
    getSetting("delivery.purim_day_choices"),
  ]);
  return {
    bulkFeePerDestinationCents: rules.bulkFeePerDestinationCents,
    perPackageFeeCents: rules.perPackageFeeCents,
    // Filled per request by quoteShippingDestinations once method choices exist.
    shippingRateByDestination: {},
    deliveryZips,
    purimDayChoices,
  };
}

/**
 * Live Shippo rates for every destination the customer chose SHIPPING for
 * (P8, UR-003 — replaces the P5 flat placeholder). Each destination is
 * bin-packed from its own lines and quoted through the margin engine; the
 * customer is charged the highest per-carrier best rate. A failed quote simply
 * stays out of the map — computeFees fails closed with a human message.
 */
async function quoteShippingDestinations(
  priced: PricedCart,
  recipients: CheckoutRecipient[],
  choices: MethodChoice[],
  methods: { id: string; kind: "BULK_DELIVERY" | "PER_PACKAGE_DELIVERY" | "SHIPPING" | "PICKUP" }[]
): Promise<{ rates: Record<string, number>; quoteIds: Record<string, string> }> {
  const shippingMethodIds = new Set(methods.filter((method) => method.kind === "SHIPPING").map((method) => method.id));
  const choiceByRecipient = new Map(choices.map((choice) => [choice.recipientKey, choice.methodId]));
  const shippingRecipients = recipients.filter((recipient) => {
    const methodId = choiceByRecipient.get(recipient.key);
    return methodId !== undefined && shippingMethodIds.has(methodId);
  });
  if (shippingRecipients.length === 0) return { rates: {}, quoteIds: {} };

  const pricedById = new Map(priced.lines.map((line) => [line.id, line]));
  const productIds = [
    ...new Set(
      shippingRecipients.flatMap((recipient) =>
        recipient.lineIds.map((lineId) => pricedById.get(lineId)?.productId).filter((id): id is string => Boolean(id))
      )
    ),
  ];
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, lengthCm: true, widthCm: true, heightCm: true, weightGrams: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  // Two recipients at one address ship in one consignment — merge their items.
  const byDestination = new Map<string, { to: CheckoutRecipient; items: PackItem[] }>();
  for (const recipient of shippingRecipients) {
    const items: PackItem[] = recipient.lineIds.flatMap((lineId) => {
      const line = pricedById.get(lineId);
      const product = line ? productById.get(line.productId) : undefined;
      if (!line || !product) return [];
      return [
        {
          name: product.name,
          quantity: line.quantity,
          lengthCm: product.lengthCm,
          widthCm: product.widthCm,
          heightCm: product.heightCm,
          weightGrams: product.weightGrams,
        },
      ];
    });
    const destination = destinationKey(recipient.address);
    const entry = byDestination.get(destination);
    if (entry) entry.items.push(...items);
    else byDestination.set(destination, { to: recipient, items });
  }

  const rates: Record<string, number> = {};
  const quoteIds: Record<string, string> = {};
  for (const [destination, { to, items }] of byDestination) {
    const quoted = await quoteShipping(
      { name: to.recipientName, ...to.address },
      items
    );
    if (!("error" in quoted)) {
      rates[destination] = quoted.decision.chargeCents;
      quoteIds[destination] = quoted.quoteId;
    }
  }
  return { rates, quoteIds };
}

/**
 * Everything checkout needs to render and validate, derived fresh from the DB
 * on every call: re-priced cart (never client totals — R-034/R-149), resolved
 * recipients, active methods, fee config, and — when method choices are given —
 * the computed fee result.
 */
export async function buildCheckoutQuote(
  seasonId: string,
  cart: Cart,
  customerId: string | null,
  choices: MethodChoice[] | null,
  deliveryDay: string | null
): Promise<CheckoutQuote | { error: string }> {
  const priced = await priceCart(seasonId, cart);
  if (priced.lines.length === 0) return { error: "Your cart is empty" };

  const recipients = await resolveCheckoutRecipients(cart, customerId);
  if (!recipients) return { error: "Every item needs a recipient before checkout" };

  const [methods, config] = await Promise.all([
    db.fulfillmentMethod.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    loadFeeRuleConfig(),
  ]);

  let fees: FeeResult | null = null;
  if (choices) {
    const quoted = await quoteShippingDestinations(priced, recipients, choices, methods);
    config.shippingRateByDestination = quoted.rates;
    config.shippingQuoteIdByDestination = quoted.quoteIds;
    fees = computeFees(recipients, choices, methods, config, deliveryDay);
  }

  return {
    priced,
    recipients,
    methods: methods.map(({ id, code, name, kind }) => ({ id, code, name, kind })),
    config,
    fees,
  };
}
