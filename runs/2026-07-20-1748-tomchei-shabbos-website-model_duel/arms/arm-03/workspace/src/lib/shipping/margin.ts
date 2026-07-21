import {
  getRates,
  getShippoEnv,
  type ShippoAddress,
  type ShippoParcel,
  type ShippoRate,
} from "@/lib/shippo/client";

/** Ground-equivalent service tokens eligible for high-quote / low-buy (plan risk #2). */
const GROUND_SERVICES = new Set([
  "FEDEX_GROUND",
  "fedex_ground",
  "GROUND_HOME_DELIVERY",
  "UPS_GROUND",
  "ups_ground",
  "GROUND",
  "PRIORITY",
  "usps_priority",
  "ParcelSelect",
  "PARCEL_SELECT",
]);

const ELIGIBLE_CARRIERS = new Set(["fedex", "ups", "usps"]);

export type MarginDecision = {
  quotes: ShippoRate[];
  eligible: ShippoRate[];
  /** Highest eligible quote — customer charge. */
  chargeRate: ShippoRate;
  /** Cheapest eligible quote — purchase target. */
  buyRate: ShippoRate;
  chargedCents: number;
  purchasedCents: number;
  marginCents: number;
};

export function isGroundEquivalent(rate: ShippoRate): boolean {
  const token = rate.serviceLevel;
  if (GROUND_SERVICES.has(token)) return true;
  const upper = token.toUpperCase();
  return upper.includes("GROUND") || upper.includes("PRIORITY") || upper.includes("PARCEL");
}

/**
 * Per carrier, keep the cheapest ground-equivalent rate, then:
 * charge = max, buy = min, margin = charge − buy (UR-003 / G-006).
 */
export function selectMargin(quotes: ShippoRate[]): MarginDecision {
  const eligible = quotes.filter(
    (q) => ELIGIBLE_CARRIERS.has(q.carrier.toLowerCase()) && isGroundEquivalent(q),
  );
  if (eligible.length === 0) {
    throw new Error("No eligible ground carrier quotes for margin selection");
  }

  const bestByCarrier = new Map<string, ShippoRate>();
  for (const quote of eligible) {
    const key = quote.carrier.toLowerCase();
    const prev = bestByCarrier.get(key);
    if (!prev || quote.amountCents < prev.amountCents) bestByCarrier.set(key, quote);
  }
  const perCarrier = [...bestByCarrier.values()];
  let chargeRate = perCarrier[0]!;
  let buyRate = perCarrier[0]!;
  for (const rate of perCarrier) {
    if (rate.amountCents > chargeRate.amountCents) chargeRate = rate;
    if (rate.amountCents < buyRate.amountCents) buyRate = rate;
  }

  return {
    quotes,
    eligible: perCarrier,
    chargeRate,
    buyRate,
    chargedCents: chargeRate.amountCents,
    purchasedCents: buyRate.amountCents,
    marginCents: chargeRate.amountCents - buyRate.amountCents,
  };
}

export async function quoteMargin(input: {
  addressTo: ShippoAddress;
  parcel: ShippoParcel;
  addressFrom?: ShippoAddress;
}): Promise<MarginDecision> {
  const from = input.addressFrom ?? getShippoEnv().origin;
  const quotes = await getRates({
    addressFrom: from,
    addressTo: input.addressTo,
    parcel: input.parcel,
  });
  return selectMargin(quotes);
}
