import { createHash, randomBytes } from "node:crypto";

// Dev/test Shippo double (documented seam, same honesty class as the P5
// Stripe fixtures): deterministic Shippo-shaped responses over real HTTP, so
// the wrapper, margin engine, quote persistence, and label lifecycle all run
// for real without a live Shippo account. Served by
// /api/dev/shippo-fixture (404 unless DEV_AUTH_BYPASS=true).
//
// Scripted behaviors (driven by destination line1, so smoke/tests choose):
//   contains "BADADDR"   → address validation fails with carrier messages
//   contains "FAILBUY"   → the transaction returns status ERROR (R-175 leg)
//   contains "FAILRATES" → the shipment create 500s (quote-time API failure)
//
// Pricing is zip-zoned so smoke can flip WHICH carrier is high: out west
// (zip 9xxxx) UPS beats its own east-coast price by 1.9x and becomes the
// expensive carrier, proving selection follows the math, not a hardcoded
// carrier.

export interface FixtureAddress {
  name?: string;
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface FixtureParcel {
  length: string;
  width: string;
  height: string;
  distance_unit: string;
  weight: string;
  mass_unit: string;
}

interface CarrierSpec {
  base: number;
  perKg: number;
  services: Record<string, { factor: number; name: string }>;
}

export const FIXTURE_CARRIERS: Record<string, CarrierSpec> = {
  fedex: {
    base: 1450,
    perKg: 120,
    services: {
      fedex_ground: { factor: 1.0, name: "FedEx Ground®" },
      fedex_express_saver: { factor: 1.8, name: "FedEx Express Saver®" },
    },
  },
  ups: {
    base: 1050,
    perKg: 100,
    services: {
      ups_ground: { factor: 1.0, name: "UPS® Ground" },
      ups_next_day_air: { factor: 2.2, name: "UPS Next Day Air®" },
    },
  },
  usps: {
    base: 800,
    perKg: 90,
    services: {
      usps_priority: { factor: 1.0, name: "USPS Priority Mail" },
    },
  },
};

export function fixtureZoneFactors(zip: string | undefined): Record<string, number> {
  const clean = (zip ?? "").replace(/\D/g, "");
  if (clean.startsWith("0")) return { fedex: 1.0, ups: 1.0, usps: 1.0 };
  if (clean.startsWith("9")) return { fedex: 1.0, ups: 1.9, usps: 1.1 };
  return { fedex: 1.3, ups: 1.2, usps: 1.15 };
}

export function fixtureRateCents(carrier: string, serviceToken: string, parcels: FixtureParcel[], zip: string | undefined): number {
  const spec = FIXTURE_CARRIERS[carrier];
  if (!spec) throw new Error(`unknown fixture carrier ${carrier}`);
  const service = spec.services[serviceToken];
  if (!service) throw new Error(`unknown fixture service ${serviceToken}`);
  const totalGrams = parcels.reduce((sum, parcel) => sum + Number(parcel.weight || "0"), 0);
  const kilos = Math.max(1, Math.ceil(totalGrams / 1000));
  const zone = fixtureZoneFactors(zip)[carrier] ?? 1.25;
  return Math.round((spec.base + kilos * spec.perKg) * service.factor * zone);
}

interface StoredShipment {
  to: FixtureAddress;
  rates: {
    object_id: string;
    amount: string;
    currency: string;
    provider: string;
    servicelevel: { token: string; name: string };
    estimated_days: number;
  }[];
}

interface StoredTransaction {
  shipmentId: string;
  rateId: string;
  amount: string;
  provider: string;
  serviceToken: string;
  status: string;
  tracking_number: string;
  label_url: string;
}

// In-memory object store: the double runs inside the single dev/smoke server
// process, so object ids resolve exactly like Shippo's without a database.
const shipments = new Map<string, StoredShipment>();
const transactions = new Map<string, StoredTransaction>();
// Rate ids are content-derived (deterministic across identical quotes), so a
// rate can appear in many shipments; the registry points each rate at the
// NEWEST shipment that quoted it — the shipment a caller just created before
// buying, which is exactly how the wrapper consumes rates.
const rateToShipment = new Map<string, string>();

function objectId(prefix: string, seed: string): string {
  return `${prefix}_${createHash("sha1").update(seed + randomBytes(6).toString("hex")).digest("hex").slice(0, 20)}`;
}

function rateIdFor(carrier: string, serviceToken: string, amountCents: number): string {
  return `rate_${carrier}_${serviceToken}_${amountCents}`;
}

function parseRateId(rateId: string): { carrier: string; serviceToken: string; amountCents: number } | null {
  const match = /^rate_(fedex|ups|usps)_(.+)_(0|[1-9]\d*)$/.exec(rateId);
  if (!match) return null;
  return { carrier: match[1], serviceToken: match[2], amountCents: Number(match[3]) };
}

function serviceDisplayName(carrier: string, token: string): string {
  return FIXTURE_CARRIERS[carrier]?.services[token]?.name ?? token;
}

export function fixtureCreateShipment(body: {
  address_to?: FixtureAddress;
  parcels?: FixtureParcel[];
}): { status: number; payload: unknown } {
  const to = body.address_to ?? {};
  const parcels = body.parcels ?? [];
  if ((to.street1 ?? "").includes("FAILRATES")) {
    return { status: 500, payload: { detail: "fixture: carrier rate service is down" } };
  }
  if (parcels.length === 0) {
    return { status: 400, payload: { messages: [{ text: "at least one parcel is required" }] } };
  }
  const shipmentId = objectId("shp", JSON.stringify(to) + JSON.stringify(parcels));
  const rates: StoredShipment["rates"] = [];
  for (const [carrier, spec] of Object.entries(FIXTURE_CARRIERS)) {
    for (const [token, service] of Object.entries(spec.services)) {
      const amountCents = fixtureRateCents(carrier, token, parcels, to.zip);
      rates.push({
        object_id: rateIdFor(carrier, token, amountCents),
        amount: (amountCents / 100).toFixed(2),
        currency: "USD",
        provider: carrier,
        servicelevel: { token, name: service.name },
        estimated_days: token.includes("next_day") ? 1 : token.includes("express") ? 3 : 5,
      });
    }
  }
  shipments.set(shipmentId, { to, rates });
  for (const rate of rates) {
    rateToShipment.set(rate.object_id, shipmentId);
  }
  return { status: 201, payload: { object_id: shipmentId, status: "SUCCESS", rates, messages: [] } };
}

export function fixtureCreateTransaction(body: { rate?: string }): { status: number; payload: unknown } {
  const rateId = body.rate ?? "";
  const parsed = parseRateId(rateId);
  const shipmentId = rateToShipment.get(rateId);
  const stored = shipmentId ? shipments.get(shipmentId) : undefined;
  if (!parsed || !stored || !shipmentId) {
    return { status: 400, payload: { messages: [{ text: `unknown rate ${rateId}` }] } };
  }
  if ((stored.to.street1 ?? "").includes("FAILBUY")) {
    return {
      status: 201,
      payload: {
        object_id: objectId("txn", rateId),
        status: "ERROR",
        messages: [{ text: "carrier account declined the shipment (insufficient funds on fixture account)" }],
      },
    };
  }
  const transactionId = objectId("txn", rateId);
  const tracking = `1Z${parsed.carrier.toUpperCase()}${createHash("sha1").update(transactionId).digest("hex").slice(0, 10).toUpperCase()}`;
  const transaction: StoredTransaction = {
    shipmentId,
    rateId,
    amount: (parsed.amountCents / 100).toFixed(2),
    provider: parsed.carrier,
    serviceToken: parsed.serviceToken,
    status: "SUCCESS",
    tracking_number: tracking,
    label_url: `http://fixture.invalid/labels/${transactionId}.pdf`,
  };
  transactions.set(transactionId, transaction);
  return {
    status: 201,
    payload: {
      object_id: transactionId,
      status: "SUCCESS",
      tracking_number: tracking,
      label_url: transaction.label_url,
      messages: [],
      rate: {
        object_id: rateId,
        amount: transaction.amount,
        provider: parsed.carrier,
        servicelevel: { token: parsed.serviceToken, name: serviceDisplayName(parsed.carrier, parsed.serviceToken) },
      },
    },
  };
}

export function fixtureCreateRefund(body: { transaction?: string }): { status: number; payload: unknown } {
  const transaction = transactions.get(body.transaction ?? "");
  if (!transaction) {
    return { status: 201, payload: { object_id: "", status: "ERROR", messages: [{ text: "unknown transaction" }] } };
  }
  return { status: 201, payload: { object_id: objectId("ref", body.transaction ?? ""), status: "SUCCESS", messages: [] } };
}

export function fixtureValidateAddress(body: FixtureAddress): { status: number; payload: unknown } {
  const invalid = (body.street1 ?? "").includes("BADADDR");
  return {
    status: 201,
    payload: {
      object_id: objectId("adr", JSON.stringify(body)),
      validation_results: {
        is_valid: !invalid,
        messages: invalid
          ? [
              { text: "Address not found", code: "address_not_found" },
              { text: "Invalid house number", code: "invalid_house_number" },
            ]
          : [],
      },
    },
  };
}

export function fixtureGetTrack(carrier: string, trackingNumber: string): { status: number; payload: unknown } {
  const known = [...transactions.values()].find((transaction) => transaction.tracking_number === trackingNumber);
  if (!known) {
    return { status: 404, payload: { detail: "tracking number not found" } };
  }
  return {
    status: 200,
    payload: {
      tracking_status: {
        status: "TRANSIT",
        status_details: `Fixture scan: package moving through the ${carrier} network`,
        status_date: new Date().toISOString(),
      },
    },
  };
}
