import { z } from "zod";
import { env } from "@/lib/env";

// R-173/R-183: one lazy Shippo client. ponytail ladder — native fetch + zod
// cover the five verbs P8 needs (rate, buy, void, track, validate), so the
// shippo npm package is not a dependency. The org's negotiated FedEx + UPS
// accounts ride on the shipment request's carrier_accounts (resolution 6);
// UPS direct credentials are declared-but-unused (R-184).

export class ShippoNotConfiguredError extends Error {
  constructor() {
    super("Carrier shipping is not configured on this deployment yet (SHIPPO_API_TOKEN missing)");
    this.name = "ShippoNotConfiguredError";
  }
}

export class ShippoApiError extends Error {
  readonly status: number;
  constructor(path: string, status: number, detail: string) {
    super(`Shippo ${path} failed (${status}): ${detail}`);
    this.name = "ShippoApiError";
    this.status = status;
  }
}

export interface ShippoConfig {
  token: string;
  baseUrl: string;
  fedexAccountId: string | null;
  upsAccountId: string | null;
  includeUsps: boolean;
}

let shippoConfigCache: ShippoConfig | null = null;

export function getShippoConfig(): ShippoConfig | null {
  if (!shippoConfigCache) {
    const token = env.SHIPPO_API_TOKEN;
    if (!token) return null;
    shippoConfigCache = {
      token,
      baseUrl: env.SHIPPO_BASE_URL ?? "https://api.goshippo.com",
      fedexAccountId: env.SHIPPO_FEDEX_ACCOUNT_ID ?? null,
      upsAccountId: env.SHIPPO_UPS_ACCOUNT_ID ?? null,
      includeUsps: env.SHIPPO_INCLUDE_USPS === "true",
    };
  }
  return shippoConfigCache;
}

export interface ShippoAddress {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface ShippoParcel {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightGrams: number;
}

const rateSchema = z.object({
  object_id: z.string(),
  amount: z.string(),
  currency: z.string().default("USD"),
  provider: z.string(),
  servicelevel: z
    .object({ token: z.string().default(""), name: z.string().default("") })
    .passthrough()
    .default({ token: "", name: "" }),
  estimated_days: z.number().nullish(),
});

const shipmentSchema = z.object({
  object_id: z.string(),
  status: z.string().default("SUCCESS"),
  rates: z.array(rateSchema).default([]),
  messages: z.array(z.object({ text: z.string().default("") }).passthrough()).default([]),
});

const transactionSchema = z.object({
  object_id: z.string(),
  status: z.string(),
  tracking_number: z.string().nullish(),
  label_url: z.string().nullish(),
  commercial_invoice_url: z.string().nullish(),
  messages: z.array(z.object({ text: z.string().default("") }).passthrough()).default([]),
  rate: z
    .object({
      object_id: z.string(),
      amount: z.string(),
      provider: z.string().default(""),
      servicelevel: z
        .object({ token: z.string().default(""), name: z.string().default("") })
        .passthrough()
        .default({ token: "", name: "" }),
    })
    .passthrough()
    .nullish(),
});

const refundSchema = z.object({
  object_id: z.string().default(""),
  status: z.string(),
  messages: z.array(z.object({ text: z.string().default("") }).passthrough()).default([]),
});

const trackSchema = z.object({
  tracking_status: z
    .object({
      status: z.string().default("UNKNOWN"),
      status_details: z.string().nullish(),
      status_date: z.string().nullish(),
    })
    .passthrough()
    .nullish(),
});

const addressResultSchema = z.object({
  object_id: z.string().default(""),
  validation_results: z
    .object({
      is_valid: z.boolean(),
      messages: z
        .array(z.object({ text: z.string().default(""), code: z.string().default("") }).passthrough())
        .default([]),
    })
    .passthrough()
    .nullish(),
});

export type ShippoRate = z.infer<typeof rateSchema>;
export type ShippoShipment = z.infer<typeof shipmentSchema>;
export type ShippoTransaction = z.infer<typeof transactionSchema>;

function toShippoAddress(address: ShippoAddress): Record<string, string> {
  return {
    name: address.name,
    street1: address.line1,
    ...(address.line2 ? { street2: address.line2 } : {}),
    city: address.city,
    state: address.region,
    zip: address.postalCode,
    country: address.country,
  };
}

function toShippoParcel(parcel: ShippoParcel): Record<string, string> {
  return {
    length: String(parcel.lengthMm),
    width: String(parcel.widthMm),
    height: String(parcel.heightMm),
    distance_unit: "mm",
    weight: String(parcel.weightGrams),
    mass_unit: "g",
  };
}

async function shippoFetch<T>(method: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const config = getShippoConfig();
  if (!config) throw new ShippoNotConfiguredError();
  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: {
      authorization: `ShippoToken ${config.token}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      raw && typeof raw === "object"
        ? JSON.stringify(raw).slice(0, 300)
        : `HTTP ${response.status} with an unreadable body`;
    throw new ShippoApiError(path, response.status, detail);
  }
  return schema.parse(raw);
}

// Rate shopping: one shipment create returns every carrier's rates for the
// parcel set (async=false + carrier_accounts is the synchronous Shippo path).
export async function createShipmentWithRates(input: {
  origin: ShippoAddress;
  destination: ShippoAddress;
  parcels: ShippoParcel[];
}): Promise<ShippoShipment> {
  const config = getShippoConfig();
  if (!config) throw new ShippoNotConfiguredError();
  const carrierAccounts = [config.fedexAccountId, config.upsAccountId].filter(
    (id): id is string => id !== null,
  );
  return shippoFetch(
    "POST",
    "/shipments/",
    {
      address_from: toShippoAddress(input.origin),
      address_to: toShippoAddress(input.destination),
      parcels: input.parcels.map(toShippoParcel),
      ...(carrierAccounts.length > 0 ? { carrier_accounts: carrierAccounts } : {}),
      async: false,
    },
    shipmentSchema,
  );
}

export async function buyLabelTransaction(rateId: string): Promise<ShippoTransaction> {
  return shippoFetch("POST", "/transactions/", { rate: rateId, label_file_type: "PDF", async: false }, transactionSchema);
}

export type ShippoRefund = z.infer<typeof refundSchema>;

export async function voidLabelTransaction(transactionId: string): Promise<ShippoRefund> {
  return shippoFetch("POST", "/refunds/", { transaction: transactionId, async: false }, refundSchema);
}

export interface ShippoTrackStatus {
  status: string;
  statusDetails: string | null;
  statusDate: string | null;
}

export async function getTracking(carrier: string, trackingNumber: string): Promise<ShippoTrackStatus> {
  const track = await shippoFetch(
    "GET",
    `/tracks/${encodeURIComponent(carrier)}/${encodeURIComponent(trackingNumber)}`,
    undefined,
    trackSchema,
  );
  return {
    status: track.tracking_status?.status ?? "UNKNOWN",
    statusDetails: track.tracking_status?.status_details ?? null,
    statusDate: track.tracking_status?.status_date ?? null,
  };
}

export interface AddressValidation {
  isValid: boolean;
  messages: string[];
}

// R-177: Shippo address validation runs before any money moves — an
// undeliverable address must fail the label attempt, never the carrier's.
export async function validateAddress(address: ShippoAddress): Promise<AddressValidation> {
  const result = await shippoFetch(
    "POST",
    "/addresses/",
    { ...toShippoAddress(address), validate: true },
    addressResultSchema,
  );
  return {
    isValid: result.validation_results?.is_valid ?? false,
    messages: (result.validation_results?.messages ?? []).map((message) => message.text).filter((text) => text.length > 0),
  };
}
