import { destinationKey, type CheckoutRecipient } from "@/lib/checkout/recipients";

// Delivery fee rules (R-033, G-014, UR-009):
// - BULK_DELIVERY: one fee per distinct destination address (two recipients at
//   one address share a fee); staff schedules the drop later, so no day choice.
// - PER_PACKAGE_DELIVERY: one fee per recipient; HARD zip block (no override),
//   and the order must pick one manager-set Purim-week day.
// - PICKUP: free. SHIPPING: the live margin-engine charge per destination
//   (P8, UR-003) — the caller quotes Shippo and passes the resolved amounts in;
//   a shipping destination without a live rate fails closed (never a guess).
// Pure function over plain inputs so the whole matrix is unit-testable.

export type FulfillmentKindValue = "BULK_DELIVERY" | "PER_PACKAGE_DELIVERY" | "SHIPPING" | "PICKUP";

export type MethodChoice = { recipientKey: string; methodId: string };

export type FeeRuleConfig = {
  bulkFeePerDestinationCents: number;
  perPackageFeeCents: number;
  /** Live margin-engine charge per destinationKey (P8). */
  shippingRateByDestination: Record<string, number>;
  /** ShippingQuote row behind each live rate — anchors labels to the paid quote. */
  shippingQuoteIdByDestination?: Record<string, string>;
  deliveryZips: string[];
  purimDayChoices: string[];
};

export type FeeLine = {
  label: string;
  methodId: string;
  amountCents: number;
  recipientKeys: string[];
  /** Shipping lines only: destinationKey + quote row, so label purchase can anchor to this charge. */
  destination?: string;
  quoteId?: string;
};

export type FeeResult =
  | { ok: true; feesCents: number; feeLines: FeeLine[]; requiresDeliveryDay: boolean }
  | { ok: false; errors: string[] };

export function computeFees(
  recipients: CheckoutRecipient[],
  choices: MethodChoice[],
  methods: { id: string; name: string; kind: FulfillmentKindValue; isActive: boolean }[],
  config: FeeRuleConfig,
  deliveryDay: string | null
): FeeResult {
  const methodById = new Map(methods.map((method) => [method.id, method]));
  const choiceByRecipient = new Map(choices.map((choice) => [choice.recipientKey, choice.methodId]));

  const errors: string[] = [];
  const feeLines: FeeLine[] = [];
  // destination key -> recipients, per method (bulk fees collapse per address)
  const bulkDestinations = new Map<string, { methodId: string; label: string; keys: string[] }>();
  const shippingDestinations = new Map<string, { methodId: string; label: string; keys: string[] }>();
  let requiresDeliveryDay = false;

  for (const recipient of recipients) {
    const methodId = choiceByRecipient.get(recipient.key);
    const method = methodId ? methodById.get(methodId) : undefined;
    if (!method || !method.isActive) {
      errors.push(`Choose a delivery method for ${recipient.recipientName}`);
      continue;
    }

    switch (method.kind) {
      case "PICKUP":
        break;
      case "BULK_DELIVERY": {
        const destination = destinationKey(recipient.address);
        const entry = bulkDestinations.get(destination);
        if (entry) entry.keys.push(recipient.key);
        else
          bulkDestinations.set(destination, {
            methodId: method.id,
            label: `${method.name} — ${recipient.address.line1}, ${recipient.address.zip}`,
            keys: [recipient.key],
          });
        break;
      }
      case "PER_PACKAGE_DELIVERY": {
        // Hard zip block (G-014): out-of-zone cannot select this method at all.
        if (!config.deliveryZips.includes(recipient.address.zip)) {
          errors.push(
            `${method.name} is not available for ${recipient.recipientName} — ZIP ${recipient.address.zip} is outside the delivery area`
          );
          break;
        }
        requiresDeliveryDay = true;
        feeLines.push({
          label: `${method.name} — ${recipient.recipientName}`,
          methodId: method.id,
          amountCents: config.perPackageFeeCents,
          recipientKeys: [recipient.key],
        });
        break;
      }
      case "SHIPPING": {
        const destination = destinationKey(recipient.address);
        const entry = shippingDestinations.get(destination);
        if (entry) entry.keys.push(recipient.key);
        else
          shippingDestinations.set(destination, {
            methodId: method.id,
            label: `${method.name} — ${recipient.address.line1}, ${recipient.address.zip}`,
            keys: [recipient.key],
          });
        break;
      }
    }
  }

  for (const entry of bulkDestinations.values()) {
    feeLines.push({
      label: entry.label,
      methodId: entry.methodId,
      amountCents: config.bulkFeePerDestinationCents,
      recipientKeys: entry.keys,
    });
  }
  for (const [destination, entry] of shippingDestinations) {
    const liveRate = config.shippingRateByDestination[destination];
    if (liveRate === undefined) {
      // Money fails closed: never charge a guessed shipping amount.
      errors.push(`Live shipping rates are unavailable for ${entry.label} — try again in a moment`);
      continue;
    }
    feeLines.push({
      label: entry.label,
      methodId: entry.methodId,
      amountCents: liveRate,
      recipientKeys: entry.keys,
      destination,
      quoteId: config.shippingQuoteIdByDestination?.[destination],
    });
  }

  if (requiresDeliveryDay) {
    if (!deliveryDay) errors.push("Pick a Purim-week delivery day for the packages we deliver");
    else if (!config.purimDayChoices.includes(deliveryDay))
      errors.push("That delivery day is not offered this season — pick one of the listed days");
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    feesCents: feeLines.reduce((sum, line) => sum + line.amountCents, 0),
    feeLines,
    requiresDeliveryDay,
  };
}
