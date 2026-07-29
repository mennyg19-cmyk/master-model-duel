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
  line2?: string | null;
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
      line2: input.recipient.line2 ?? null,
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

// M9: the display fan-out is capped (a merged checkout must not burst one
// Shippo shipment-creation per recipient at once) and cached 60s per
// (order, recipient, address) so checkout re-renders don't re-hit Shippo.
// Failed quotes cache too — a carrier outage shouldn't be retried per render.
const DISPLAY_QUOTE_CONCURRENCY = 4;
const DISPLAY_QUOTE_CACHE_TTL_MS = 60_000;

const displayQuoteCache = new Map<string, { value: ShippingQuoteDisplay; expiresAt: number }>();

function displayCacheKey(orderId: string, recipient: RecipientQuoteTarget): string {
  return [orderId, recipient.id, recipient.line1, recipient.line2 ?? "", recipient.postalCode].join("|");
}

function cachedDisplay(key: string): ShippingQuoteDisplay | undefined {
  const entry = displayQuoteCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    displayQuoteCache.delete(key);
    return undefined;
  }
  return entry.value;
}

// Display-side fan-out for the checkout pages: every recipient gets a quote
// (or an honest reason the SHIPPED option is off). A quote failure degrades
// one option — it never breaks the whole checkout.
export async function quoteCheckoutShipping(input: {
  orderId: string;
  recipients: RecipientQuoteTarget[];
}): Promise<Record<string, ShippingQuoteDisplay>> {
  const result: Record<string, ShippingQuoteDisplay> = {};
  const misses: RecipientQuoteTarget[] = [];
  for (const recipient of input.recipients) {
    const cached = cachedDisplay(displayCacheKey(input.orderId, recipient));
    if (cached) result[recipient.id] = cached;
    else misses.push(recipient);
  }
  for (let i = 0; i < misses.length; i += DISPLAY_QUOTE_CONCURRENCY) {
    const batch = misses.slice(i, i + DISPLAY_QUOTE_CONCURRENCY);
    const entries = await Promise.all(
      batch.map(async (recipient) => {
        let value: ShippingQuoteDisplay;
        try {
          // Display quotes never write rate-lock rows — only the submit's
          // re-quote persists (R-155).
          const resolved = await quoteRecipientShipping(prisma, {
            orderId: input.orderId,
            recipient,
            persist: false,
          });
          value = { available: true, ...resolved };
        } catch (error) {
          if (!isQuoteFailure(error)) throw error;
          value = { available: false, reason: error.message };
        }
        if (displayQuoteCache.size >= 500) displayQuoteCache.clear();
        displayQuoteCache.set(displayCacheKey(input.orderId, recipient), {
          value,
          expiresAt: Date.now() + DISPLAY_QUOTE_CACHE_TTL_MS,
        });
        return [recipient.id, value] as const;
      }),
    );
    for (const [id, value] of entries) result[id] = value;
  }
  return result;
}
