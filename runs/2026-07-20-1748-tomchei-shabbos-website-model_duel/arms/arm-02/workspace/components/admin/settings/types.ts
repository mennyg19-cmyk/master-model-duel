// Shared shapes for the settings hub and its tab components.

export type SeasonRow = {
  id: string;
  name: string;
  status: "OPEN" | "CLOSED";
  /** ISO strings — Date objects can't cross the server/client boundary. */
  opensAt: string | null;
  closesAt: string | null;
};
export type PackageTypeRow = {
  id: string;
  name: string;
  widthCm: number | null;
  lengthCm: number | null;
  heightCm: number | null;
  weightGrams: number | null;
};
export type PickupLocationRow = {
  id: string;
  name: string;
  line1: string;
  city: string;
  state: string;
  zip: string;
  isActive: boolean;
};
export type ShippingRate = { name: string; amountCents: number };
export type ShippingRules = { bulkFeePerDestinationCents: number; perPackageFeeCents: number };

export type SettingsHubData = {
  seasons: SeasonRow[];
  packageTypes: PackageTypeRow[];
  pickupLocations: PickupLocationRow[];
  followupDays: number;
  closedMessage: string;
  deliveryZips: string[];
  shippingRates: ShippingRate[];
  shippingRules: ShippingRules;
  purimDayChoices: string[];
  emailFrom: string;
  emailReplyTo: string;
  emailBrandingFooter: string;
  emailLogRetentionDays: number;
};

/** Runs a mutation, surfaces the outcome message, and refreshes on success. */
export type ActFn = (action: () => Promise<{ ok: boolean; error?: string }>, successMessage?: string) => Promise<void>;
/** PATCHes one key through /api/admin/settings via ActFn. */
export type SaveSettingFn = (key: string, value: unknown, successMessage?: string) => Promise<void>;
