import { sumCents } from '../core/money';
import type { CarrierRate } from './provider';

/**
 * The margin engine (UR-003, G-006).
 *
 * The org quotes every carrier it can ship with, charges the customer the
 * highest of those quotes, and buys the label on the cheapest. The difference
 * funds the campaign, so it is worked out in one pure place and stored as three
 * numbers, not recovered later by re-quoting a rate that has since changed.
 *
 * Eligibility is the other half. A carrier that could not price every parcel of
 * a multi-carton box is not a carrier that can ship it, and quoting one that
 * cannot would either overcharge the customer or hand the label to a carrier
 * that will refuse the second carton.
 */
export type ShippingOption = {
  carrier: string;
  serviceCode: string;
  serviceLabel: string;
  /** One rate id per parcel, in parcel order — what the labels are bought against. */
  rateIds: string[];
  costCents: number;
  transitDays: number | null;
  isEligible: boolean;
};

export type MarginPlan = {
  options: ShippingOption[];
  /** The highest eligible quote: what the customer pays for this box. */
  customerPriceCents: number;
  /** The cheapest eligible quote: what the label is bought on. */
  purchase: ShippingOption;
  marginCents: number;
};

/**
 * Turns each carrier's per-parcel answers into one price for the whole box.
 *
 * A service is only offered for the box if it came back for every parcel; the
 * cost is the sum, and the transit estimate is the slowest parcel, because the
 * box is not delivered until the last carton is.
 */
export function combineParcelRates(parcelRates: CarrierRate[][]): ShippingOption[] {
  if (parcelRates.length === 0) return [];

  const byService = new Map<string, { rate: CarrierRate; parcels: CarrierRate[] }>();

  for (const rates of parcelRates) {
    // At most one rate per service per parcel. Carriers do return the same
    // service twice — two accounts, two negotiated tables — and counting both
    // would make a service that priced one parcel of two look eligible for the
    // whole box, which is the check that keeps a second carton from being
    // refused at the counter.
    const seen = new Set<string>();

    for (const rate of rates) {
      const key = `${rate.carrier}:${rate.serviceCode}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const existing = byService.get(key);
      if (existing) existing.parcels.push(rate);
      else byService.set(key, { rate, parcels: [rate] });
    }
  }

  return [...byService.values()]
    .map(({ rate, parcels }) => ({
      carrier: rate.carrier,
      serviceCode: rate.serviceCode,
      serviceLabel: rate.serviceLabel,
      rateIds: parcels.map((parcel) => parcel.rateId),
      costCents: sumCents(parcels.map((parcel) => parcel.amountCents)),
      transitDays: slowestOf(parcels),
      isEligible: parcels.length === parcelRates.length,
    }))
    .sort(byCostThenName);
}

/** Null when no carrier can ship the box, which is a refusal, not a price of zero. */
export function planMargin(options: ShippingOption[]): MarginPlan | null {
  const eligible = options.filter((option) => option.isEligible).sort(byCostThenName);
  if (eligible.length === 0) return null;

  const purchase = eligible[0];
  const customerPriceCents = eligible[eligible.length - 1].costCents;

  return {
    options,
    customerPriceCents,
    purchase,
    marginCents: customerPriceCents - purchase.costCents,
  };
}

/**
 * Splits a box's money evenly across its parcels, remainder on the last, so the
 * parcel rows add back up to the cent. A box that is one parcel — nearly all of
 * them — gets the whole amount and no arithmetic.
 */
export function allocateCustomerPrice(totalCents: number, parcelCount: number): number[] {
  if (parcelCount <= 1) return [totalCents];

  const each = Math.floor(totalCents / parcelCount);
  const shares = Array.from({ length: parcelCount }, () => each);
  shares[parcelCount - 1] += totalCents - each * parcelCount;

  return shares;
}

/**
 * Cheapest first. Ties break on the faster service and then on the carrier's
 * name, so the same quotes always pick the same label — a coin toss here would
 * mean the screen and the purchase could disagree.
 */
function byCostThenName(left: ShippingOption, right: ShippingOption): number {
  if (left.costCents !== right.costCents) return left.costCents - right.costCents;

  const leftDays = left.transitDays ?? Number.MAX_SAFE_INTEGER;
  const rightDays = right.transitDays ?? Number.MAX_SAFE_INTEGER;
  if (leftDays !== rightDays) return leftDays - rightDays;

  return `${left.carrier}:${left.serviceCode}`.localeCompare(`${right.carrier}:${right.serviceCode}`);
}

function slowestOf(parcels: CarrierRate[]): number | null {
  const known = parcels.map((parcel) => parcel.transitDays).filter((days): days is number => days !== null);
  return known.length === 0 ? null : Math.max(...known);
}
