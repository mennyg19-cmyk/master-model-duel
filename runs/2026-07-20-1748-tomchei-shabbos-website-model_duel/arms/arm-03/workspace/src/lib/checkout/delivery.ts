import { getSetting } from "@/lib/settings";
import {
  DEFAULT_DELIVERY_ZIPS,
  STORE_SETTINGS,
  isDeliveryZipAllowed,
  normalizeZip,
  type DeliveryZipsSetting,
} from "@/lib/storefront/settings-keys";

export const FULFILLMENT_CODES = {
  SHIP: "SHIP",
  PICKUP: "PICKUP",
  BULK_DELIVERY: "BULK_DELIVERY",
  PER_PACKAGE_DELIVERY: "PER_PACKAGE_DELIVERY",
} as const;

export type DeliveryFeeSettings = {
  bulkDestinationFeeCents: number;
  perPackageFeeCents: number;
  placeholderShipRateCents: number;
};

export const DEFAULT_DELIVERY_FEES: DeliveryFeeSettings = {
  bulkDestinationFeeCents: 500,
  perPackageFeeCents: 800,
  placeholderShipRateCents: 1200,
};

export type PurimWeekSettings = {
  days: string[];
};

export const DEFAULT_PURIM_WEEK: PurimWeekSettings = {
  days: ["2026-03-13", "2026-03-14", "2026-03-15"],
};

export type CheckoutLineForFees = {
  id: string;
  recipientName: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  fulfillmentMethodCode: string | null;
};

export type DeliveryFeeBreakdown = {
  bulkDestinationCount: number;
  bulkFeeCents: number;
  perPackageRecipientCount: number;
  perPackageFeeCents: number;
  shipLineCount: number;
  shipFeeCents: number;
  totalFeeCents: number;
  blockedZips: string[];
};

function destinationKey(line: CheckoutLineForFees): string {
  return [
    (line.recipientName ?? "").trim().toLowerCase(),
    (line.addressLine1 ?? "").trim().toLowerCase(),
    (line.city ?? "").trim().toLowerCase(),
    (line.state ?? "").trim().toLowerCase(),
    normalizeZip(line.postalCode ?? ""),
    (line.country ?? "US").trim().toLowerCase(),
  ].join("|");
}

/** Destination only (no recipient) — bulk fee is per destination address. */
function addressOnlyKey(line: CheckoutLineForFees): string {
  return [
    (line.addressLine1 ?? "").trim().toLowerCase(),
    (line.city ?? "").trim().toLowerCase(),
    (line.state ?? "").trim().toLowerCase(),
    normalizeZip(line.postalCode ?? ""),
    (line.country ?? "US").trim().toLowerCase(),
  ].join("|");
}

export async function loadDeliveryFees(): Promise<DeliveryFeeSettings> {
  const stored = await getSetting<Partial<DeliveryFeeSettings>>(STORE_SETTINGS.deliveryFees);
  return { ...DEFAULT_DELIVERY_FEES, ...(stored ?? {}) };
}

export async function loadAllowedDeliveryZips(): Promise<string[]> {
  const stored = await getSetting<DeliveryZipsSetting>(STORE_SETTINGS.deliveryZips);
  return (stored ?? DEFAULT_DELIVERY_ZIPS).zips;
}

export async function loadPurimWeekDays(): Promise<string[]> {
  const stored = await getSetting<PurimWeekSettings>(STORE_SETTINGS.purimWeekDays);
  return (stored ?? DEFAULT_PURIM_WEEK).days;
}

/**
 * Placeholder rate-resolution (live Shippo deferred to P8).
 * BULK: one fee per destination. PER_PACKAGE: fee per recipient + hard zip block.
 */
export function resolveDeliveryFees(
  lines: CheckoutLineForFees[],
  fees: DeliveryFeeSettings,
  allowedZips: string[],
): DeliveryFeeBreakdown {
  const blockedZips: string[] = [];
  const bulkDestinations = new Set<string>();
  const perPackageRecipients = new Set<string>();
  let shipLineCount = 0;

  for (const line of lines) {
    const code = line.fulfillmentMethodCode;
    if (!code) continue;

    if (code === FULFILLMENT_CODES.PER_PACKAGE_DELIVERY) {
      const zip = line.postalCode ?? "";
      if (!isDeliveryZipAllowed(zip, allowedZips)) {
        blockedZips.push(normalizeZip(zip) || "(missing)");
        continue;
      }
      perPackageRecipients.add(destinationKey(line));
    } else if (code === FULFILLMENT_CODES.BULK_DELIVERY) {
      bulkDestinations.add(addressOnlyKey(line));
    } else if (code === FULFILLMENT_CODES.SHIP) {
      shipLineCount += 1;
    }
  }

  const uniqueBlocked = [...new Set(blockedZips)];
  const bulkFeeCents = bulkDestinations.size * fees.bulkDestinationFeeCents;
  const perPackageFeeCents = perPackageRecipients.size * fees.perPackageFeeCents;
  const shipFeeCents = shipLineCount * fees.placeholderShipRateCents;

  return {
    bulkDestinationCount: bulkDestinations.size,
    bulkFeeCents,
    perPackageRecipientCount: perPackageRecipients.size,
    perPackageFeeCents,
    shipLineCount,
    shipFeeCents,
    totalFeeCents: bulkFeeCents + perPackageFeeCents + shipFeeCents,
    blockedZips: uniqueBlocked,
  };
}

export class ZipBlockedError extends Error {
  readonly zips: string[];

  constructor(zips: string[]) {
    super(
      `Per-package delivery is not available for zip(s): ${zips.join(", ")}. No manager override.`,
    );
    this.name = "ZipBlockedError";
    this.zips = zips;
  }
}

export function assertPerPackageZipsAllowed(breakdown: DeliveryFeeBreakdown): void {
  if (breakdown.blockedZips.length > 0) {
    throw new ZipBlockedError(breakdown.blockedZips);
  }
}
