import { env } from "@/lib/env";
import { mockRates, type CarrierRate, type Parcel, type ShipAddress } from "@/lib/shipping/mock-rates";

// Shippo wrapper (R-173, R-177): rate / buy / void / track / validate. With
// SHIPPO_API_TOKEN set it talks REST to api.goshippo.com using the org's
// FedEx + UPS carrier accounts. Without a token (this harness) it runs in mock
// mode: deterministic fixture rates (lib/shipping/mock-rates.ts) derived from
// destination ZIP and parcel weight, so margin math is exactly reproducible in
// tests — the same pattern as the Stripe mock gateway (plan risk #3:
// negotiated rates aren't reproducible in Shippo test mode anyway).

export type { CarrierRate, Parcel, ShipAddress } from "@/lib/shipping/mock-rates";

export type PurchasedLabel = {
  transactionId: string;
  labelUrl: string;
  trackingNumber: string;
};

export type AddressCheck = { valid: boolean; messages: string[] };

export function shippoMode(): "live" | "mock" {
  return env.SHIPPO_API_TOKEN ? "live" : "mock";
}

export class ShippoError extends Error {}

// ---------------------------------------------------------------------------
// Live REST plumbing.
// ---------------------------------------------------------------------------

const SHIPPO_BASE = "https://api.goshippo.com";

async function shippoFetch(path: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${SHIPPO_BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `ShippoToken ${env.SHIPPO_API_TOKEN}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new ShippoError(`Shippo ${path} failed (${response.status}): ${JSON.stringify(payload).slice(0, 300)}`);
  }
  return payload;
}

function toShippoAddress(address: ShipAddress) {
  return {
    name: address.name,
    street1: address.line1,
    street2: address.line2 ?? undefined,
    city: address.city,
    state: address.state,
    zip: address.zip,
    country: "US",
  };
}

/** Quote all eligible carriers for the given parcels (R-173). */
export async function getRates(from: ShipAddress, to: ShipAddress, parcels: Parcel[]): Promise<CarrierRate[]> {
  if (parcels.length === 0) throw new ShippoError("Nothing to ship — no parcels were planned");
  if (shippoMode() === "mock") return mockRates(to, parcels);

  const shipment = await shippoFetch("/shipments/", {
    address_from: toShippoAddress(from),
    address_to: toShippoAddress(to),
    parcels: parcels.map((parcel) => ({
      length: parcel.lengthCm,
      width: parcel.widthCm,
      height: parcel.heightCm,
      distance_unit: "cm",
      weight: parcel.weightGrams,
      mass_unit: "g",
    })),
    carrier_accounts: [env.SHIPPO_FEDEX_ACCOUNT_ID, env.SHIPPO_UPS_ACCOUNT_ID],
    async: false,
  });
  const rates = Array.isArray(shipment.rates) ? (shipment.rates as Record<string, unknown>[]) : [];
  return rates.map((rate) => ({
    rateId: String(rate.object_id),
    carrier: String(rate.provider),
    service: String((rate.servicelevel as Record<string, unknown> | undefined)?.name ?? rate.servicelevel),
    amountCents: Math.round(Number.parseFloat(String(rate.amount)) * 100),
    estimatedDays: typeof rate.estimated_days === "number" ? rate.estimated_days : null,
  }));
}

/** Buy the label for a previously quoted rate. Throws on carrier refusal (R-175 caller compensates). */
export async function buyLabel(rateId: string): Promise<PurchasedLabel> {
  if (shippoMode() === "mock") {
    if (rateId.startsWith("mockfail|")) {
      throw new ShippoError("Carrier refused the label purchase (mock failure fixture)");
    }
    const [, carrier] = rateId.split("|");
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return {
      transactionId: `mocktx_${suffix}`,
      labelUrl: `https://shippo.example/labels/mocktx_${suffix}.pdf`,
      trackingNumber: `${(carrier ?? "MOCK").slice(0, 3).toUpperCase()}${suffix.toUpperCase()}`,
    };
  }

  const transaction = await shippoFetch("/transactions/", {
    rate: rateId,
    label_file_type: "PDF",
    async: false,
  });
  if (transaction.status !== "SUCCESS") {
    const messages = Array.isArray(transaction.messages)
      ? (transaction.messages as { text?: string }[]).map((entry) => entry.text).filter(Boolean).join("; ")
      : "";
    throw new ShippoError(`Label purchase failed: ${messages || String(transaction.status)}`);
  }
  return {
    transactionId: String(transaction.object_id),
    labelUrl: String(transaction.label_url),
    trackingNumber: String(transaction.tracking_number),
  };
}

/** Void/refund a purchased label. */
export async function voidLabel(transactionId: string): Promise<void> {
  if (shippoMode() === "mock") return;
  await shippoFetch("/refunds/", { transaction: transactionId, async: false });
}

/** Latest carrier tracking status for a purchased label (R-176). */
export async function trackShipment(carrier: string, trackingNumber: string): Promise<string> {
  if (shippoMode() === "mock") return "TRANSIT";
  const tracked = await shippoFetch(`/tracks/${encodeURIComponent(carrier.toLowerCase())}/${encodeURIComponent(trackingNumber)}`);
  const status = (tracked.tracking_status as Record<string, unknown> | undefined)?.status;
  return typeof status === "string" ? status : "UNKNOWN";
}

/** Shippo address validation (R-177) — run before any label purchase. */
export async function validateAddress(address: ShipAddress): Promise<AddressCheck> {
  if (shippoMode() === "mock") {
    const messages: string[] = [];
    if (!/^\d{5}$/.test(address.zip)) messages.push("ZIP code must be 5 digits");
    if (address.line1.trim().length < 4) messages.push("Street address looks incomplete");
    if (!address.city.trim()) messages.push("City is required");
    return { valid: messages.length === 0, messages };
  }

  const result = await shippoFetch("/addresses/", { ...toShippoAddress(address), validate: true });
  const validation = result.validation_results as { is_valid?: boolean; messages?: { text?: string }[] } | undefined;
  return {
    valid: validation?.is_valid === true,
    messages: (validation?.messages ?? []).map((entry) => entry.text ?? "").filter(Boolean),
  };
}
