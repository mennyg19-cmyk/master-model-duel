import type { ShippoRate } from "@/lib/shipping/shippo";

// UR-003/G-006: the margin engine. Quote every eligible carrier, charge the
// customer the HIGHEST eligible quote, buy the label on the CHEAPEST eligible
// carrier, and book the spread. Pure functions — the HTTP and DB live in
// quotes.ts / labels.ts so this law is unit-testable without either.

export interface RateOption {
  rateId: string;
  carrier: string;
  serviceLevel: string;
  serviceName: string;
  amountCents: number;
  estimatedDays: number | null;
}

// Comparability rule (merged plan open risk): only ground-comparable service
// levels compete — quoting FedEx Ground against UPS Next Day Air would
// fabricate margin, not capture it. Cheapest eligible service per carrier
// enters the contest.
export const GROUND_SERVICE_TOKENS: Record<string, readonly string[]> = {
  fedex: ["fedex_ground", "fedex_home_delivery"],
  ups: ["ups_ground"],
  usps: ["usps_priority", "usps_ground_advantage"],
};

export function carrierOf(provider: string): string {
  return provider.trim().toLowerCase();
}

export function normalizeRates(rates: ShippoRate[]): RateOption[] {
  return rates
    .map((rate) => ({
      rateId: rate.object_id,
      carrier: carrierOf(rate.provider),
      serviceLevel: rate.servicelevel.token,
      serviceName: rate.servicelevel.name || rate.servicelevel.token || rate.provider,
      amountCents: Math.round(Number(rate.amount) * 100),
      estimatedDays: rate.estimated_days ?? null,
    }))
    .filter((rate) => Number.isFinite(rate.amountCents) && rate.amountCents >= 0);
}

// One cheapest ground-comparable rate per carrier. USPS enters only when the
// deployment includes it ("where applicable" — org accounts are FedEx + UPS).
export function eligibleRates(options: RateOption[], includeUsps: boolean): RateOption[] {
  const cheapestByCarrier = new Map<string, RateOption>();
  for (const option of options) {
    const groundTokens = GROUND_SERVICE_TOKENS[option.carrier];
    if (!groundTokens || !groundTokens.includes(option.serviceLevel)) continue;
    if (option.carrier === "usps" && !includeUsps) continue;
    const current = cheapestByCarrier.get(option.carrier);
    if (!current || option.amountCents < current.amountCents) {
      cheapestByCarrier.set(option.carrier, option);
    }
  }
  return [...cheapestByCarrier.values()].sort(
    (a, b) => a.amountCents - b.amountCents || a.carrier.localeCompare(b.carrier),
  );
}

export interface MarginResolution {
  charge: RateOption;
  buy: RateOption;
  marginCents: number;
  eligible: RateOption[];
}

// Charge = highest eligible quote; buy = cheapest eligible quote. One carrier
// quoting alone charges and buys the same rate — margin 0, honestly recorded.
export function resolveMargin(options: RateOption[], includeUsps: boolean): MarginResolution | null {
  const eligible = eligibleRates(options, includeUsps);
  if (eligible.length === 0) return null;
  const buy = eligible[0];
  const charge = eligible[eligible.length - 1];
  return { charge, buy, marginCents: charge.amountCents - buy.amountCents, eligible };
}
