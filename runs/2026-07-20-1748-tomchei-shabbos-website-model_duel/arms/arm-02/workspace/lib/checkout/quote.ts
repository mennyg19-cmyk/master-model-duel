import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { priceCart, type Cart, type PricedCart } from "@/lib/order-builder/cart";
import { resolveCheckoutRecipients, type CheckoutRecipient } from "@/lib/checkout/recipients";
import { computeFees, type FeeResult, type FeeRuleConfig, type MethodChoice } from "@/lib/checkout/fees";

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

export async function loadFeeRuleConfig(): Promise<FeeRuleConfig> {
  const [rules, deliveryZips, purimDayChoices, rates] = await Promise.all([
    getSetting("shipping.rules"),
    getSetting("shipping.delivery_zips"),
    getSetting("delivery.purim_day_choices"),
    getSetting("shipping.rates"),
  ]);
  return {
    bulkFeePerDestinationCents: rules.bulkFeePerDestinationCents,
    perPackageFeeCents: rules.perPackageFeeCents,
    // Placeholder rate resolution (R-032): first configured flat rate stands in
    // for live Shippo rates until P8 wires the margin engine.
    shippingPlaceholderCents: rates[0]?.amountCents ?? 1500,
    deliveryZips,
    purimDayChoices,
  };
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

  const fees = choices
    ? computeFees(recipients, choices, methods, config, deliveryDay)
    : null;

  return {
    priced,
    recipients,
    methods: methods.map(({ id, code, name, kind }) => ({ id, code, name, kind })),
    config,
    fees,
  };
}
