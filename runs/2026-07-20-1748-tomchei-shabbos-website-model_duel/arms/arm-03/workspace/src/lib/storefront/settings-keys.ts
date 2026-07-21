export const STORE_SETTINGS = {
  storeStatus: "store.status",
  packageTypesNote: "store.packageTypesNote",
  pickupFollowUp: "store.pickupFollowUp",
  shippingRates: "shipping.rates",
  shippingRules: "shipping.rules",
  deliveryZips: "shipping.deliveryZips",
  emailFrom: "email.from",
  emailReplyTo: "email.replyTo",
  developerNotes: "developer.notes",
  impactStats: "marketing.impactStats",
  testimonials: "marketing.testimonials",
} as const;

export type DeliveryZipsSetting = {
  zips: string[];
  versionNote?: string;
};

export type ImpactStat = { label: string; value: string };
export type Testimonial = { quote: string; name: string; role?: string };

export const DEFAULT_DELIVERY_ZIPS: DeliveryZipsSetting = {
  zips: ["11218", "11219", "11230", "11204"],
};

export const DEFAULT_IMPACT: ImpactStat[] = [
  { label: "Families served last Purim", value: "1,240" },
  { label: "Packages delivered", value: "3,800+" },
  { label: "Volunteer drivers", value: "160" },
];

export const DEFAULT_TESTIMONIALS: Testimonial[] = [
  {
    quote: "Knowing our mishloach manot reached families with dignity means everything.",
    name: "Sara K.",
    role: "Donor",
  },
  {
    quote: "The pickup was calm and organized — we felt cared for, not processed.",
    name: "Anonymous recipient",
  },
];

export function normalizeZip(zip: string): string {
  return zip.trim().replace(/\s+/g, "").slice(0, 10);
}

export function isDeliveryZipAllowed(zip: string, allowed: string[]): boolean {
  const normalized = normalizeZip(zip);
  if (!normalized) return false;
  return allowed.map(normalizeZip).includes(normalized);
}
