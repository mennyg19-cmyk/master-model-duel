import { randomUUID } from "node:crypto";

type Carrier = "FEDEX" | "UPS" | "USPS";

export type ShippingAddress = {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
  phone?: string | null;
  email?: string | null;
};

export type ShipmentParcel = {
  lengthInches: number;
  widthInches: number;
  heightInches: number;
  weightOunces: number;
};

export type ShippoRate = {
  id: string;
  carrier: Carrier;
  service: string;
  amountCents: number;
  expiresAt: Date;
};

export type MarginSelection = {
  charge: ShippoRate;
  purchase: ShippoRate;
  spreadCents: number;
};

export type ShippoLabel = {
  id: string;
  labelUrl: string | null;
  trackingNumber: string | null;
  trackingStatus: string | null;
};

export type AddressValidation = {
  isValid: boolean;
  messages: string[];
};

export type ShippoClient = {
  mode: "fixture" | "live";
  quoteShipment: (shipment: { from: ShippingAddress; to: ShippingAddress; parcel: ShipmentParcel }) => Promise<ShippoRate[]>;
  buyLabel: (rateId: string) => Promise<ShippoLabel>;
  voidLabel: (labelId: string) => Promise<void>;
  refreshTracking: (labelId: string) => Promise<{ trackingNumber: string | null; trackingStatus: string | null }>;
  validateAddress: (address: ShippingAddress) => Promise<AddressValidation>;
};

type ShippoEnvironment = {
  apiToken?: string;
  fedexCarrierAccountId?: string;
  upsCarrierAccountId?: string;
};

const shippoBaseUrl = "https://api.goshippo.com";
const eligibleCarriers = new Set<Carrier>(["FEDEX", "UPS", "USPS"]);

function optionalEnvironmentValue(name: string) {
  const value = process.env[name]?.trim();
  return value && !value.includes("replace_me") ? value : undefined;
}

export function getShippoEnvironment(): ShippoEnvironment {
  return {
    apiToken: optionalEnvironmentValue("SHIPPO_API_TOKEN"),
    fedexCarrierAccountId: optionalEnvironmentValue("SHIPPO_FEDEX_CARRIER_ACCOUNT_ID"),
    upsCarrierAccountId: optionalEnvironmentValue("SHIPPO_UPS_CARRIER_ACCOUNT_ID"),
  };
}

function fixtureRates(postalCode: string): ShippoRate[] {
  const reversesCarriers = Number.parseInt(postalCode.at(-1) ?? "0", 10) % 2 === 0;
  const amounts = reversesCarriers
    ? { FEDEX: 1425, UPS: 1975, USPS: 1650 }
    : { FEDEX: 2050, UPS: 1495, USPS: 1710 };
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  return [
    { id: `rate_fixture_fedex_${postalCode}`, carrier: "FEDEX", service: "FedEx Ground", amountCents: amounts.FEDEX, expiresAt },
    { id: `rate_fixture_ups_${postalCode}`, carrier: "UPS", service: "UPS Ground", amountCents: amounts.UPS, expiresAt },
    { id: `rate_fixture_usps_${postalCode}`, carrier: "USPS", service: "USPS Ground Advantage", amountCents: amounts.USPS, expiresAt },
  ];
}

function isGroundEquivalent(rate: ShippoRate) {
  return /ground|home delivery/i.test(rate.service);
}

export function selectMarginRate(rates: readonly ShippoRate[]): MarginSelection {
  const availableRates = rates.filter((rate) =>
    eligibleCarriers.has(rate.carrier)
    && isGroundEquivalent(rate)
    && rate.amountCents >= 0
    && rate.expiresAt.getTime() > Date.now(),
  );
  if (!availableRates.length) throw new Error("Shippo returned no eligible ground-equivalent carrier rates.");
  const charge = availableRates.reduce((highest, rate) => rate.amountCents > highest.amountCents ? rate : highest);
  const purchase = availableRates.reduce((lowest, rate) => rate.amountCents < lowest.amountCents ? rate : lowest);
  return { charge, purchase, spreadCents: charge.amountCents - purchase.amountCents };
}

function formatAddress(address: ShippingAddress) {
  return {
    name: address.name,
    street1: address.line1,
    street2: address.line2 || undefined,
    city: address.city,
    state: address.state,
    zip: address.postalCode,
    country: address.country ?? "US",
    phone: address.phone || undefined,
    email: address.email || undefined,
  };
}

async function requestShippo<T>(token: string, path: string, init: RequestInit) {
  const response = await fetch(`${shippoBaseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `ShippoToken ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Shippo request failed", { path, status: response.status, detail: body.detail });
    throw new Error("Shippo rejected the request. Review the server log for provider details.");
  }
  return body as T;
}

function parseLiveRates(rawRates: Array<{ object_id?: string; provider?: string; amount?: string; servicelevel?: { name?: string } }>) {
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  return rawRates.flatMap((rawRate): ShippoRate[] => {
    const carrier = rawRate.provider?.toUpperCase() as Carrier | undefined;
    const amountCents = Number.parseFloat(rawRate.amount ?? "") * 100;
    if (!carrier || !eligibleCarriers.has(carrier) || !rawRate.object_id || !Number.isFinite(amountCents)) return [];
    return [{
      id: rawRate.object_id,
      carrier,
      service: rawRate.servicelevel?.name ?? "Unknown service",
      amountCents: Math.round(amountCents),
      expiresAt,
    }];
  });
}

function createFixtureClient(): ShippoClient {
  return {
    mode: "fixture",
    quoteShipment: async ({ to }) => fixtureRates(to.postalCode),
    buyLabel: async (rateId) => ({
      id: `label_fixture_${randomUUID().replaceAll("-", "")}`,
      labelUrl: `https://example.invalid/shippo/${rateId}.pdf`,
      trackingNumber: `TRACK-${rateId.slice(-12).toUpperCase()}`,
      trackingStatus: "PRE_TRANSIT",
    }),
    voidLabel: async () => undefined,
    refreshTracking: async (labelId) => ({ trackingNumber: `TRACK-${labelId.slice(-12).toUpperCase()}`, trackingStatus: "IN_TRANSIT" }),
    validateAddress: async (address) => ({
      isValid: Boolean(address.name && address.line1 && address.city && address.state && /^\d{5}(?:-\d{4})?$/.test(address.postalCode)),
      messages: [],
    }),
  };
}

function createLiveClient(environment: Required<Pick<ShippoEnvironment, "apiToken">> & ShippoEnvironment): ShippoClient {
  const carrierAccounts = [environment.fedexCarrierAccountId, environment.upsCarrierAccountId].filter((accountId): accountId is string => Boolean(accountId));
  return {
    mode: "live",
    quoteShipment: async ({ from, to, parcel }) => {
      const shipment = await requestShippo<{ rates?: Array<{ object_id?: string; provider?: string; amount?: string; servicelevel?: { name?: string } }> }>(
        environment.apiToken,
        "/shipments/",
        {
          method: "POST",
          body: JSON.stringify({
            address_from: formatAddress(from),
            address_to: formatAddress(to),
            parcels: [{
              length: String(parcel.lengthInches),
              width: String(parcel.widthInches),
              height: String(parcel.heightInches),
              distance_unit: "in",
              weight: String(parcel.weightOunces),
              mass_unit: "oz",
            }],
            async: false,
            ...(carrierAccounts.length ? { carrier_accounts: carrierAccounts } : {}),
          }),
        },
      );
      return parseLiveRates(shipment.rates ?? []);
    },
    buyLabel: async (rateId) => {
      const transaction = await requestShippo<{ object_id?: string; label_url?: string; tracking_number?: string; tracking_status?: string }>(
        environment.apiToken,
        "/transactions/",
        { method: "POST", body: JSON.stringify({ rate: rateId, label_file_type: "PDF", async: false }) },
      );
      if (!transaction.object_id) throw new Error("Shippo did not return a label transaction ID.");
      return {
        id: transaction.object_id,
        labelUrl: transaction.label_url ?? null,
        trackingNumber: transaction.tracking_number ?? null,
        trackingStatus: transaction.tracking_status ?? null,
      };
    },
    voidLabel: async (labelId) => {
      await requestShippo(environment.apiToken, "/refunds/", { method: "POST", body: JSON.stringify({ transaction: labelId }) });
    },
    refreshTracking: async (labelId) => {
      const transaction = await requestShippo<{ tracking_number?: string; tracking_status?: string }>(environment.apiToken, `/transactions/${labelId}/`, { method: "GET" });
      return { trackingNumber: transaction.tracking_number ?? null, trackingStatus: transaction.tracking_status ?? null };
    },
    validateAddress: async (address) => {
      const created = await requestShippo<{ object_id?: string }>(environment.apiToken, "/addresses/", { method: "POST", body: JSON.stringify(formatAddress(address)) });
      if (!created.object_id) throw new Error("Shippo did not return an address ID.");
      const validation = await requestShippo<{ validation_results?: { is_valid?: boolean; messages?: Array<{ text?: string }> } }>(
        environment.apiToken,
        `/addresses/${created.object_id}/validate/`,
        { method: "POST", body: "{}" },
      );
      return {
        isValid: validation.validation_results?.is_valid !== false,
        messages: validation.validation_results?.messages?.flatMap((message) => message.text ? [message.text] : []) ?? [],
      };
    },
  };
}

export function createShippoClient(environment = getShippoEnvironment()): ShippoClient {
  return environment.apiToken ? createLiveClient({ ...environment, apiToken: environment.apiToken }) : createFixtureClient();
}
