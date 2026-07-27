import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { planParcels, type PackItem } from "@/lib/shipping/bin-packing";
import { resolveMargin, type MarginDecision } from "@/lib/shipping/margin";
import { getRates, type ShipAddress } from "@/lib/shipping/shippo";

// Live shipping quotes for checkout (replaces the P5 placeholder path) and for
// label purchase. Every quote is persisted as a ShippingQuote row with its
// expiry (R-155) so the purchase step and P12 reconciliation can see what the
// customer's charge was based on.

const QUOTE_TTL_MS = 20 * 60 * 1000;

export type ShippingQuoteResult = {
  decision: MarginDecision;
  parcels: ReturnType<typeof planParcels>;
  quoteId: string;
};

export async function loadShipmentBoxes() {
  return db.shipmentBox.findMany({ orderBy: { name: "asc" } });
}

export async function loadOrigin(): Promise<ShipAddress> {
  return getSetting("shipping.origin");
}

/**
 * Bin-pack the items, quote all eligible carriers, run the margin engine, and
 * persist the comparison set. Throws nothing — quoting failures come back as
 * `{ error }` so checkout can fail closed with a human message.
 */
export async function quoteShipping(
  to: ShipAddress,
  items: PackItem[],
  ref: { orderId?: string; packageId?: string } = {}
): Promise<ShippingQuoteResult | { error: string }> {
  const [origin, boxes] = await Promise.all([loadOrigin(), loadShipmentBoxes()]);
  const parcels = planParcels(items, boxes);
  if (parcels.length === 0) return { error: "Nothing to ship for this destination" };

  let decision: MarginDecision;
  try {
    const rates = await getRates(origin, to, parcels);
    const resolved = resolveMargin(rates);
    if ("error" in resolved) return resolved;
    decision = resolved;
  } catch (error) {
    return { error: `Live shipping rates are unavailable right now (${(error as Error).message})` };
  }

  const quote = await db.shippingQuote.create({
    data: {
      orderId: ref.orderId,
      packageId: ref.packageId,
      provider: "shippo",
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
      options: {
        create: decision.perCarrierBest.map((rate) => ({
          carrier: rate.carrier,
          service: rate.service,
          amountCents: rate.amountCents,
          estimatedDays: rate.estimatedDays,
        })),
      },
    },
  });

  return { decision, parcels, quoteId: quote.id };
}
