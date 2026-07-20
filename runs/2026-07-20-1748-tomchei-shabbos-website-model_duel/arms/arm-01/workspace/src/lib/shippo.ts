import { readServerEnvironment } from "@/lib/env";

export type ShippingAddress = {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
};

export type ShippingParcel = {
  lengthInches: number;
  widthInches: number;
  heightInches: number;
  weightOunces: number;
};

export type CarrierRate = {
  id: string;
  carrier: string;
  serviceCode: string;
  serviceName: string;
  amountCents: number;
  currency: string;
  expiresAt: Date;
};

export type PurchasedLabel = {
  transactionId: string;
  trackingNumber: string;
  trackingStatus: string;
  labelUrl: string;
};

export type AddressValidation = {
  isValid: boolean;
  messages: string[];
  normalizedAddress?: ShippingAddress;
};

export interface ShippingProvider {
  getRates(input: {
    from: ShippingAddress;
    to: ShippingAddress;
    parcels: ShippingParcel[];
  }): Promise<CarrierRate[]>;
  buyLabel(rateId: string): Promise<PurchasedLabel>;
  voidLabel(transactionId: string): Promise<void>;
  track(carrier: string, trackingNumber: string): Promise<{ status: string }>;
  validateAddress(address: ShippingAddress): Promise<AddressValidation>;
}

const shippoBaseUrl = "https://api.goshippo.com";

function cents(amount: string) {
  return Math.round(Number.parseFloat(amount) * 100);
}

function mapAddress(address: ShippingAddress) {
  return {
    name: address.name,
    street1: address.street1,
    street2: address.street2,
    city: address.city,
    state: address.state,
    zip: address.zip,
    country: address.country,
  };
}

export class ShippoProvider implements ShippingProvider {
  constructor(
    private readonly token: string,
    private readonly carrierAccountIds: readonly string[] = [],
  ) {}

  private async request(path: string, init?: RequestInit) {
    const response = await fetch(`${shippoBaseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `ShippoToken ${this.token}`,
        "content-type": "application/json",
        ...init?.headers,
      },
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        typeof payload.detail === "string"
          ? `Shippo request failed: ${payload.detail}`
          : `Shippo request failed with HTTP ${response.status}.`,
      );
    }
    return payload;
  }

  async getRates(input: {
    from: ShippingAddress;
    to: ShippingAddress;
    parcels: ShippingParcel[];
  }) {
    const payload = await this.request("/shipments/", {
      method: "POST",
      body: JSON.stringify({
        address_from: mapAddress(input.from),
        address_to: mapAddress(input.to),
        parcels: input.parcels.map((parcel) => ({
          length: parcel.lengthInches.toFixed(2),
          width: parcel.widthInches.toFixed(2),
          height: parcel.heightInches.toFixed(2),
          distance_unit: "in",
          weight: parcel.weightOunces.toFixed(2),
          mass_unit: "oz",
        })),
        ...(this.carrierAccountIds.length
          ? { carrier_accounts: this.carrierAccountIds }
          : {}),
        async: false,
      }),
    });
    const rates = Array.isArray(payload.rates) ? payload.rates : [];
    return rates.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const rate = entry as Record<string, unknown>;
      const provider = String(rate.provider ?? "").toLowerCase();
      const service = (rate.servicelevel ?? {}) as Record<string, unknown>;
      if (!["fedex", "ups", "usps"].includes(provider) || !rate.object_id || !rate.amount) {
        return [];
      }
      return [{
        id: String(rate.object_id),
        carrier: provider,
        serviceCode: String(service.token ?? "unknown"),
        serviceName: String(service.name ?? provider),
        amountCents: cents(String(rate.amount)),
        currency: String(rate.currency ?? "USD").toLowerCase(),
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
      }];
    });
  }

  async buyLabel(rateId: string) {
    const payload = await this.request("/transactions/", {
      method: "POST",
      body: JSON.stringify({ rate: rateId, label_file_type: "PDF", async: false }),
    });
    if (payload.status !== "SUCCESS") {
      throw new Error(`Shippo could not purchase the label: ${String(payload.status ?? "unknown status")}.`);
    }
    return {
      transactionId: String(payload.object_id),
      trackingNumber: String(payload.tracking_number),
      trackingStatus: "UNKNOWN",
      labelUrl: String(payload.label_url),
    };
  }

  async voidLabel(transactionId: string) {
    const payload = await this.request("/refunds/", {
      method: "POST",
      body: JSON.stringify({ transaction: transactionId, async: false }),
    });
    if (payload.status !== "REFUNDED" && payload.status !== "REFUND_PENDING") {
      throw new Error(`Shippo did not accept the label void: ${String(payload.status ?? "unknown status")}.`);
    }
  }

  async track(carrier: string, trackingNumber: string) {
    const payload = await this.request("/tracks/", {
      method: "POST",
      body: JSON.stringify({ carrier, tracking_number: trackingNumber }),
    });
    const trackingStatus = (payload.tracking_status ?? {}) as Record<string, unknown>;
    return { status: String(trackingStatus.status ?? "UNKNOWN") };
  }

  async validateAddress(address: ShippingAddress) {
    const payload = await this.request("/addresses/", {
      method: "POST",
      body: JSON.stringify({ ...mapAddress(address), validate: true }),
    });
    const validation = (payload.validation_results ?? {}) as Record<string, unknown>;
    const messages = Array.isArray(validation.messages)
      ? validation.messages.map((message) =>
          typeof message === "object" && message
            ? String((message as Record<string, unknown>).text ?? "Address needs review.")
            : String(message),
        )
      : [];
    return {
      isValid: Boolean(validation.is_valid),
      messages,
      normalizedAddress: {
        name: String(payload.name ?? address.name),
        street1: String(payload.street1 ?? address.street1),
        street2: String(payload.street2 ?? address.street2 ?? ""),
        city: String(payload.city ?? address.city),
        state: String(payload.state ?? address.state),
        zip: String(payload.zip ?? address.zip),
        country: String(payload.country ?? address.country),
      },
    };
  }
}

export function getShippingProvider() {
  const environment = readServerEnvironment();
  if (!environment.SHIPPO_API_TOKEN) return null;
  return new ShippoProvider(
    environment.SHIPPO_API_TOKEN,
    [
      environment.SHIPPO_FEDEX_ACCOUNT_ID,
      environment.SHIPPO_UPS_ACCOUNT_ID,
    ].filter((accountId): accountId is string => Boolean(accountId)),
  );
}
