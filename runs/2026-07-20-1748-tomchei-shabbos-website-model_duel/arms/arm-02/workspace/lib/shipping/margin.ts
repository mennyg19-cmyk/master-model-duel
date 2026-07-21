import type { CarrierRate } from "@/lib/shipping/shippo";

// Margin engine (UR-003, G-006). The org's pricing rule: quote every eligible
// carrier, charge the customer the HIGHEST carrier's best price, then buy the
// label on the CHEAPER carrier and keep the spread for the tzedakah. Pure
// function over rate lists so the whole matrix is unit-testable (S1).

export type MarginDecision = {
  /** What the customer is charged: the highest per-carrier best rate. */
  chargeCents: number;
  /** The rate we actually buy: the cheapest eligible quote. */
  buy: CarrierRate;
  /** chargeCents − buy.amountCents, recorded for P12 reconciliation. */
  marginCents: number;
  /** Each eligible carrier's best (cheapest) quote — the comparison set. */
  perCarrierBest: CarrierRate[];
};

export function resolveMargin(rates: CarrierRate[]): MarginDecision | { error: string } {
  if (rates.length === 0) return { error: "No carrier returned a rate for this destination" };

  const bestByCarrier = new Map<string, CarrierRate>();
  for (const rate of rates) {
    const current = bestByCarrier.get(rate.carrier);
    if (!current || rate.amountCents < current.amountCents) bestByCarrier.set(rate.carrier, rate);
  }

  const perCarrierBest = [...bestByCarrier.values()].sort((a, b) => a.amountCents - b.amountCents);
  const buy = perCarrierBest[0];
  const chargeCents = perCarrierBest[perCarrierBest.length - 1].amountCents;
  return { chargeCents, buy, marginCents: chargeCents - buy.amountCents, perCarrierBest };
}
