// Deterministic mock rate fixtures for Shippo mock mode (no env import, so
// pure unit tests can exercise the margin math without a configured runtime).
// Prices derive from (destination ZIP, parcel weights):
// - Every carrier's price = base + per-kg × billed kg, per parcel.
// - The last ZIP digit decides which of FedEx/UPS carries a remote-area
//   surcharge, so the high and low carriers genuinely differ and flip by
//   destination — exactly what the S1 margin fixtures need.
// - USPS only quotes when every parcel is under 4.5kg ("where applicable").

export type ShipAddress = {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  zip: string;
};

export type Parcel = {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightGrams: number;
};

export type CarrierRate = {
  rateId: string;
  carrier: string;
  service: string;
  amountCents: number;
  estimatedDays: number | null;
};

const MOCK_SURCHARGE_CENTS = 400;
const MOCK_CARRIERS = [
  { carrier: "FedEx", service: "FedEx Ground", baseCents: 850, perKgCents: 110, days: 3 },
  { carrier: "UPS", service: "UPS Ground", baseCents: 900, perKgCents: 95, days: 3 },
  { carrier: "USPS", service: "Priority Mail", baseCents: 700, perKgCents: 140, days: 2 },
];
const MOCK_USPS_MAX_PARCEL_GRAMS = 4500;
// Address marker for exercising the buy-failure path in mock mode (R-175).
export const MOCK_BUY_FAILURE_MARKER = "failbuy";

function billedKg(weightGrams: number): number {
  return Math.max(1, Math.ceil(weightGrams / 1000));
}

export function mockRates(to: ShipAddress, parcels: Parcel[]): CarrierRate[] {
  const zipDigit = Number.parseInt(to.zip.slice(-1), 10) || 0;
  const surchargedCarrier = zipDigit % 2 === 0 ? "FedEx" : "UPS";
  const uspsApplicable = parcels.every((parcel) => parcel.weightGrams <= MOCK_USPS_MAX_PARCEL_GRAMS);
  const failing = to.line1.toLowerCase().includes(MOCK_BUY_FAILURE_MARKER);

  return MOCK_CARRIERS.filter((entry) => entry.carrier !== "USPS" || uspsApplicable).map((entry) => {
    const amountCents = parcels.reduce(
      (sum, parcel) => sum + entry.baseCents + entry.perKgCents * billedKg(parcel.weightGrams),
      entry.carrier === surchargedCarrier ? MOCK_SURCHARGE_CENTS : 0
    );
    return {
      rateId: `${failing ? "mockfail" : "mock"}|${entry.carrier}|${entry.service}|${amountCents}`,
      carrier: entry.carrier,
      service: entry.service,
      amountCents,
      estimatedDays: entry.days,
    };
  });
}
