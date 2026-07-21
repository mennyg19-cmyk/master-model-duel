import { randomBytes } from "node:crypto";

export type ShippoMode = "live" | "test" | "mock";

export type ShippoAddress = {
  name: string;
  street1: string;
  street2?: string | null;
  city: string;
  state: string;
  zip: string;
  country?: string;
  phone?: string | null;
};

export type ShippoParcel = {
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  weightOz: number;
};

export type ShippoRate = {
  objectId: string;
  carrier: "fedex" | "ups" | "usps" | string;
  serviceLevel: string;
  amountCents: number;
  currency: string;
  providerAccount?: string;
};

export type ShippoValidation = {
  isValid: boolean;
  messages: string[];
  normalized?: ShippoAddress;
};

export type ShippoTransaction = {
  objectId: string;
  status: "SUCCESS" | "ERROR" | "QUEUED";
  trackingNumber: string | null;
  labelUrl: string | null;
  rateId: string;
  carrier: string;
  serviceLevel: string;
  amountCents: number;
  messages: string[];
};

export type ShippoTracking = {
  trackingNumber: string;
  status: string;
  carrier: string;
  updatedAt: string;
};

/** Typed optional-provider env (R-183). UPS slots declared, not implemented (R-184). */
export type ShippoEnv = {
  mode: ShippoMode;
  apiToken: string | null;
  fedexAccountId: string | null;
  upsAccountId: string | null;
  /** Declaration-only — never sent to a UPS direct API in this phase. */
  upsClientId: string | null;
  upsClientSecret: string | null;
  origin: ShippoAddress;
};

export function getShippoMode(): ShippoMode {
  const mode = (process.env.SHIPPO_MODE ?? "").trim().toLowerCase();
  if (mode === "mock") return "mock";
  if (mode === "live") return "live";
  const token = process.env.SHIPPO_API_TOKEN ?? "";
  if (!token || token.includes("mock")) return "mock";
  return "test";
}

export function getShippoEnv(): ShippoEnv {
  return {
    mode: getShippoMode(),
    apiToken: process.env.SHIPPO_API_TOKEN?.trim() || null,
    fedexAccountId: process.env.SHIPPO_FEDEX_ACCOUNT_ID?.trim() || null,
    upsAccountId: process.env.SHIPPO_UPS_ACCOUNT_ID?.trim() || null,
    upsClientId: process.env.UPS_CLIENT_ID?.trim() || null,
    upsClientSecret: process.env.UPS_CLIENT_SECRET?.trim() || null,
    origin: {
      name: process.env.SHIP_FROM_NAME?.trim() || "Tomchei Shabbos",
      street1: process.env.SHIP_FROM_STREET1?.trim() || "123 Warehouse Ave",
      city: process.env.SHIP_FROM_CITY?.trim() || "Brooklyn",
      state: process.env.SHIP_FROM_STATE?.trim() || "NY",
      zip: process.env.SHIP_FROM_ZIP?.trim() || "11218",
      country: process.env.SHIP_FROM_COUNTRY?.trim() || "US",
      phone: process.env.SHIP_FROM_PHONE?.trim() || null,
    },
  };
}

function mintId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

/**
 * Fixture rates where carriers differ (S1).
 * Destination zip ending in even digit → UPS cheaper; odd → FedEx cheaper.
 * USPS always highest among the three ground quotes.
 */
export function mockGroundRates(to: ShippoAddress): ShippoRate[] {
  const zipDigits = (to.zip.match(/\d/g) ?? []).join("");
  const last = Number.parseInt(zipDigits.slice(-1) || "0", 10);
  const upsCheaper = last % 2 === 0;
  const fedex = upsCheaper ? 1500 : 1200;
  const ups = upsCheaper ? 1200 : 1500;
  return [
    {
      objectId: mintId("rate_fedex"),
      carrier: "fedex",
      serviceLevel: "FEDEX_GROUND",
      amountCents: fedex,
      currency: "USD",
      providerAccount: getShippoEnv().fedexAccountId ?? "org_fedex_mock",
    },
    {
      objectId: mintId("rate_ups"),
      carrier: "ups",
      serviceLevel: "UPS_GROUND",
      amountCents: ups,
      currency: "USD",
      providerAccount: getShippoEnv().upsAccountId ?? "org_ups_mock",
    },
    {
      objectId: mintId("rate_usps"),
      carrier: "usps",
      serviceLevel: "PRIORITY",
      amountCents: 1800,
      currency: "USD",
    },
  ];
}

async function shippoFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const env = getShippoEnv();
  if (!env.apiToken) throw new Error("SHIPPO_API_TOKEN is required for live/test mode");
  const res = await fetch(`https://api.goshippo.com${path}`, {
    ...init,
    headers: {
      Authorization: `ShippoToken ${env.apiToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shippo ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** Rate / buy / void / track / validate (R-173). Multi-parcel = one shipment quote. */
export async function getRates(input: {
  addressFrom: ShippoAddress;
  addressTo: ShippoAddress;
  parcels: ShippoParcel[];
}): Promise<ShippoRate[]> {
  const parcelCount = Math.max(1, input.parcels.length);
  if (getShippoMode() === "mock") {
    return mockGroundRates(input.addressTo).map((rate) => ({
      ...rate,
      amountCents: rate.amountCents * parcelCount,
    }));
  }

  const env = getShippoEnv();
  const carrierAccounts = [env.fedexAccountId, env.upsAccountId].filter(
    (id): id is string => Boolean(id),
  );

  const shipment = await shippoFetch<{
    rates: Array<{
      object_id: string;
      provider: string;
      servicelevel: { token: string; name: string };
      amount: string;
      currency: string;
      carrier_account?: string;
    }>;
  }>("/shipments/", {
    method: "POST",
    body: JSON.stringify({
      address_from: toShippoAddress(input.addressFrom),
      address_to: toShippoAddress(input.addressTo),
      parcels: input.parcels.map(toShippoParcel),
      async: false,
      ...(carrierAccounts.length > 0 ? { carrier_accounts: carrierAccounts } : {}),
    }),
  });

  return (shipment.rates ?? []).map((r) => ({
    objectId: r.object_id,
    carrier: r.provider.toLowerCase(),
    serviceLevel: r.servicelevel.token || r.servicelevel.name,
    amountCents: Math.round(Number.parseFloat(r.amount) * 100),
    currency: r.currency,
    providerAccount: r.carrier_account,
  }));
}

export async function buyLabel(
  rateId: string,
  idempotencyKey?: string,
): Promise<ShippoTransaction> {
  if (getShippoMode() === "mock") {
    if (rateId.startsWith("rate_fail")) {
      return {
        objectId: mintId("txn"),
        status: "ERROR",
        trackingNumber: null,
        labelUrl: null,
        rateId,
        carrier: "ups",
        serviceLevel: "UPS_GROUND",
        amountCents: 0,
        messages: ["Mock label purchase failure"],
      };
    }
    // Stable mock txn id when idempotency key present (retry-safe).
    const objectId = idempotencyKey
      ? `txn_idem_${idempotencyKey.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`
      : mintId("txn");
    return {
      objectId,
      status: "SUCCESS",
      trackingNumber: `1ZMOCK${randomBytes(6).toString("hex").toUpperCase()}`,
      labelUrl: `https://example.invalid/labels/${rateId}.pdf`,
      rateId,
      carrier: rateId.includes("fedex") ? "fedex" : rateId.includes("usps") ? "usps" : "ups",
      serviceLevel: rateId.includes("fedex")
        ? "FEDEX_GROUND"
        : rateId.includes("usps")
          ? "PRIORITY"
          : "UPS_GROUND",
      amountCents: 0,
      messages: [],
    };
  }

  const txn = await shippoFetch<{
    object_id: string;
    status: string;
    tracking_number: string | null;
    label_url: string | null;
    rate: string;
    amount?: string;
    currency?: string;
    parcel?: unknown;
    rate_obj?: {
      provider?: string;
      servicelevel?: { token?: string; name?: string };
      amount?: string;
    };
    messages?: Array<{ text: string }>;
  }>("/transactions/", {
    method: "POST",
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    body: JSON.stringify({
      rate: rateId,
      label_file_type: "PDF",
      async: false,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    }),
  });

  const amountRaw = txn.amount ?? txn.rate_obj?.amount;
  const amountCents = amountRaw
    ? Math.round(Number.parseFloat(amountRaw) * 100)
    : 0;
  const carrier = (txn.rate_obj?.provider ?? "").toLowerCase();
  const serviceLevel =
    txn.rate_obj?.servicelevel?.token || txn.rate_obj?.servicelevel?.name || "";

  return {
    objectId: txn.object_id,
    status: txn.status === "SUCCESS" ? "SUCCESS" : "ERROR",
    trackingNumber: txn.tracking_number,
    labelUrl: txn.label_url,
    rateId: txn.rate,
    carrier,
    serviceLevel,
    amountCents,
    messages: (txn.messages ?? []).map((m) => m.text),
  };
}

export async function voidLabel(transactionId: string): Promise<{ ok: boolean; messages: string[] }> {
  if (getShippoMode() === "mock") {
    return { ok: !transactionId.startsWith("txn_fail"), messages: [] };
  }
  try {
    await shippoFetch(`/transactions/${encodeURIComponent(transactionId)}/refund/`, {
      method: "POST",
      body: "{}",
    });
    return { ok: true, messages: [] };
  } catch (error) {
    return { ok: false, messages: [error instanceof Error ? error.message : "void failed"] };
  }
}

export async function trackShipment(
  carrier: string,
  trackingNumber: string,
): Promise<ShippoTracking> {
  if (getShippoMode() === "mock") {
    return {
      trackingNumber,
      status: "TRANSIT",
      carrier,
      updatedAt: new Date().toISOString(),
    };
  }
  const data = await shippoFetch<{
    tracking_status?: { status: string; status_date: string };
  }>(`/tracks/${encodeURIComponent(carrier)}/${encodeURIComponent(trackingNumber)}/`);
  return {
    trackingNumber,
    status: data.tracking_status?.status ?? "UNKNOWN",
    carrier,
    updatedAt: data.tracking_status?.status_date ?? new Date().toISOString(),
  };
}

export async function validateAddress(address: ShippoAddress): Promise<ShippoValidation> {
  if (getShippoMode() === "mock") {
    const missing = !address.street1 || !address.city || !address.state || !address.zip;
    return {
      isValid: !missing,
      messages: missing ? ["Incomplete address"] : [],
      normalized: { ...address, country: address.country ?? "US" },
    };
  }
  const result = await shippoFetch<{
    name?: string;
    street1?: string;
    street2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    validation_results?: { is_valid?: boolean; messages?: Array<{ text: string }> };
  }>("/addresses/", {
    method: "POST",
    body: JSON.stringify({ ...toShippoAddress(address), validate: true }),
  });
  const vr = result.validation_results;
  return {
    isValid: Boolean(vr?.is_valid),
    messages: (vr?.messages ?? []).map((m) => m.text),
    normalized: {
      name: result.name ?? address.name,
      street1: result.street1 ?? address.street1,
      street2: result.street2 ?? address.street2,
      city: result.city ?? address.city,
      state: result.state ?? address.state,
      zip: result.zip ?? address.zip,
      country: result.country ?? address.country ?? "US",
    },
  };
}

function toShippoAddress(a: ShippoAddress) {
  return {
    name: a.name,
    street1: a.street1,
    street2: a.street2 ?? undefined,
    city: a.city,
    state: a.state,
    zip: a.zip,
    country: a.country ?? "US",
    phone: a.phone ?? undefined,
  };
}

function toShippoParcel(p: ShippoParcel) {
  return {
    length: String(p.lengthIn),
    width: String(p.widthIn),
    height: String(p.heightIn),
    distance_unit: "in",
    weight: String(p.weightOz),
    mass_unit: "oz",
  };
}
