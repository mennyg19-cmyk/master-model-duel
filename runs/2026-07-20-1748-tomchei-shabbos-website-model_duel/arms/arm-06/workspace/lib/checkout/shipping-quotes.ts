import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DomainRuleError } from "@/lib/errors";
import { planParcelsForLines, quoteShipping, ShippingUnavailableError } from "@/lib/shipping/quotes";
import { ShippoNotConfiguredError } from "@/lib/shipping/shippo";

// R-032 live resolution for the SHIPPED choice: one Shippo quote per
// recipient, priced on their own lines' parcel plan. Checkout pages call
// quoteCheckoutShipping to SHOW the price; submit re-quotes through
// quoteRecipientShipping so a stale page is a 409 conflict, never a wrong
// charge (R-034/R-037).

export interface RecipientQuoteTarget {
  id: string;
  name: string;
  line1: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface ResolvedRecipientQuote {
  chargedCents: number;
  serviceLabel: string;
}

export type ShippingQuoteDisplay =
  | { available: true; chargedCents: number; serviceLabel: string }
  | { available: false; reason: string };

function isQuoteFailure(error: unknown): error is ShippoNotConfiguredError | ShippingUnavailableError | DomainRuleError {
  return (
    error instanceof ShippoNotConfiguredError ||
    error instanceof ShippingUnavailableError ||
    error instanceof DomainRuleError
  );
}

// The one recipient-quote path (display + submit share it). Quote rows
// persist against the order as the R-155 rate-lock record.
export async function quoteRecipientShipping(
  db: Prisma.TransactionClient | typeof prisma,
  input: { orderId: string; recipient: RecipientQuoteTarget; persist?: boolean },
): Promise<ResolvedRecipientQuote> {
  const lines = await db.orderLine.findMany({
    where: { orderId: input.orderId, recipientId: input.recipient.id },
    select: {
      qty: true,
      parentLineId: true,
      product: { select: { lengthMm: true, widthMm: true, heightMm: true, weightGrams: true } },
    },
  });
  const parcels = await planParcelsForLines(db, lines);
  if (parcels.length === 0) {
    throw new ShippingUnavailableError("no shippable items are assigned to this recipient");
  }
  const quote = await quoteShipping({
    db,
    parcels,
    destination: {
      name: input.recipient.name,
      line1: input.recipient.line1,
      city: input.recipient.city,
      region: input.recipient.region,
      postalCode: input.recipient.postalCode,
      country: input.recipient.country,
    },
    scope: { orderId: input.orderId },
    persist: input.persist,
  });
  return { chargedCents: quote.margin.charge.amountCents, serviceLabel: quote.margin.charge.serviceName };
}

// Display-side fan-out for the checkout pages: every recipient gets a quote
// (or an honest reason the SHIPPED option is off). A quote failure degrades
// one option — it never breaks the whole checkout.
export async function quoteCheckoutShipping(input: {
  orderId: string;
  recipients: RecipientQuoteTarget[];
}): Promise<Record<string, ShippingQuoteDisplay>> {
  const entries = await Promise.all(
    input.recipients.map(async (recipient) => {
      try {
        // Display quotes never write rate-lock rows — only the submit's
        // re-quote persists (R-155).
        const resolved = await quoteRecipientShipping(prisma, {
          orderId: input.orderId,
          recipient,
          persist: false,
        });
        return [recipient.id, { available: true, ...resolved } as ShippingQuoteDisplay] as const;
      } catch (error) {
        if (isQuoteFailure(error)) {
          return [recipient.id, { available: false, reason: error.message } as ShippingQuoteDisplay] as const;
        }
        throw error;
      }
    }),
  );
  return Object.fromEntries(entries);
}
