// Shipping domain vocabulary shared by the live Shippo wrapper, the mock
// fixtures, bin packing, and the margin engine. Lives in a neutral module so
// live-mode code never depends on the mock fixture file for its types.

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
