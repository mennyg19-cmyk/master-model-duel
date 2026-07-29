import { z } from "zod";
import { isDeliverable, normalizePostalCode } from "@/lib/storefront/delivery";
import { normalizeWhitespace } from "@/lib/text";

// UR-009/G-014/G-015: per-recipient fulfillment at checkout.
//   PICKUP               — free; collected at a pickup location.
//   BULK_DELIVERY        — org delivers on a staff-scheduled run (P9); one
//                          fee per destination address.
//   PER_PACKAGE_DELIVERY — own delivery on a manager-set Purim-week day; one
//                          fee per recipient; hard ZIP allowlist block with
//                          no manager override (G-014).
//   SHIPPED              — FedEx/UPS via Shippo (P8, R-055); live rate quoted
//                          per recipient, charge = highest eligible quote
//                          (UR-003). No ZIP gate — carriers go anywhere.
export const FULFILLMENT_CHOICES = ["PICKUP", "BULK_DELIVERY", "PER_PACKAGE_DELIVERY", "SHIPPED"] as const;
export type FulfillmentChoice = (typeof FULFILLMENT_CHOICES)[number];

export interface DeliveryFees {
  bulkPerDestinationCents: number;
  perPackagePerRecipientCents: number;
}

export const recipientChoiceSchema = z.object({
  recipientId: z.string().min(1),
  fulfillmentChoice: z.enum(FULFILLMENT_CHOICES),
  deliveryDay: z.string().min(1).nullish(),
  greeting: z.string().max(500).nullish(),
});

export const checkoutSubmitSchema = z.object({
  draftRef: z.string().min(1),
  greetingDefault: z.string().max(500).nullish(),
  recipients: z.array(recipientChoiceSchema),
  expectedTotalCents: z.number().int().nonnegative(),
  // R-127: offline methods are staff-only. The field exists on the public
  // schema only so the server can refuse it explicitly instead of ignoring it.
  method: z.enum(["card", "cash", "check", "comp"]).default("card"),
});

export type CheckoutSubmitInput = z.infer<typeof checkoutSubmitSchema>;

export interface ChoiceValidation {
  ok: boolean;
  reason?: string;
}

// One recipient's choice against the live rules (zip allowlist, day list).
export function validateFulfillmentChoice(input: {
  choice: FulfillmentChoice;
  postalCode: string;
  deliveryDay: string | null | undefined;
  deliveryZips: string[];
  deliveryDays: string[];
}): ChoiceValidation {
  if (input.choice === "PICKUP") return { ok: true };
  if (input.choice === "BULK_DELIVERY") {
    // Bulk runs are staff-scheduled org routes — the hard zip block is a
    // per-package rule (G-014), not a bulk one.
    return { ok: true };
  }
  if (input.choice === "SHIPPED") {
    // Carriers go anywhere — the only SHIPPED gate is a live quote, which the
    // submit path resolves (a failed quote refuses the submit, R-032).
    return { ok: true };
  }
  if (!isDeliverable(input.deliveryZips, input.postalCode)) {
    return {
      ok: false,
      reason: `${normalizePostalCode(input.postalCode)} is outside the per-package delivery area — pickup or bulk delivery only`,
    };
  }
  if (input.deliveryDays.length === 0) {
    return { ok: false, reason: "Per-package delivery is unavailable until the manager sets delivery days" };
  }
  if (!input.deliveryDay || !input.deliveryDays.includes(input.deliveryDay)) {
    return { ok: false, reason: "Choose one of the offered delivery days" };
  }
  return { ok: true };
}

// R-032 rate resolution for the two settings-priced channels. SHIPPED never
// passes through here — submit.ts resolves its fee from a live Shippo quote.
export function resolveDeliveryFeeCents(choice: FulfillmentChoice, fees: DeliveryFees): number {
  if (choice === "BULK_DELIVERY") return fees.bulkPerDestinationCents;
  if (choice === "PER_PACKAGE_DELIVERY") return fees.perPackagePerRecipientCents;
  return 0;
}

// G-015 bulk rule: one fee per destination — recipients sharing a normalized
// address pay one bulk fee between them (the fee hangs on the first recipient
// in order, the rest snapshot 0 so per-recipient sums still add up).
export function bulkAddressKey(parts: {
  line1: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}): string {
  return [parts.line1, parts.city, parts.region, normalizePostalCode(parts.postalCode), parts.country]
    .map((part) => normalizeWhitespace(part).toLowerCase())
    .join("|");
}

// UR-013/G-020: recipient override wins; the order default is the fallback;
// blank means no card.
export function normalizeGreeting(value: string | null | undefined): string | null {
  const trimmed = value ? normalizeWhitespace(value).trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export function effectiveGreeting(
  recipientGreeting: string | null | undefined,
  orderDefault: string | null | undefined,
): string | null {
  return normalizeGreeting(recipientGreeting) ?? normalizeGreeting(orderDefault);
}
