import { quoteMargin } from "@/lib/shipping/margin";
import { getShippoEnv, type ShippoParcel } from "@/lib/shippo/client";
import {
  FULFILLMENT_CODES,
  type CheckoutLineForFees,
  type DeliveryFeeBreakdown,
  type DeliveryFeeSettings,
} from "@/lib/checkout/delivery";
import { isDeliveryZipAllowed, normalizeZip } from "@/lib/storefront/settings-keys";

export type LiveShipQuote = {
  destinationKey: string;
  chargedCents: number;
  purchasedCents: number;
  marginCents: number;
  chargeCarrier: string;
  buyCarrier: string;
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

function addressOnlyKey(line: CheckoutLineForFees): string {
  return [
    (line.addressLine1 ?? "").trim().toLowerCase(),
    (line.city ?? "").trim().toLowerCase(),
    (line.state ?? "").trim().toLowerCase(),
    normalizeZip(line.postalCode ?? ""),
    (line.country ?? "US").trim().toLowerCase(),
  ].join("|");
}

const DEFAULT_PARCEL: ShippoParcel = {
  lengthIn: 12,
  widthIn: 9,
  heightIn: 6,
  weightOz: 48,
};

/**
 * Live Shippo rate-resolution for SHIP lines (replaces P5 placeholder).
 * One margin quote per unique ship destination; customer charged highest eligible rate.
 */
export async function resolveDeliveryFeesLive(
  lines: CheckoutLineForFees[],
  fees: DeliveryFeeSettings,
  allowedZips: string[],
  parcel: ShippoParcel = DEFAULT_PARCEL,
): Promise<DeliveryFeeBreakdown & { shipQuotes: LiveShipQuote[]; liveShip: boolean }> {
  const blockedZips: string[] = [];
  const bulkDestinations = new Set<string>();
  const perPackageRecipients = new Set<string>();
  const shipDestinations = new Map<string, CheckoutLineForFees>();
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
      const key = destinationKey(line);
      if (!shipDestinations.has(key)) shipDestinations.set(key, line);
    }
  }

  const shipQuotes: LiveShipQuote[] = [];
  let shipFeeCents = 0;
  let liveShip = false;

  if (shipDestinations.size > 0) {
    liveShip = true;
    const origin = getShippoEnv().origin;
    for (const [key, line] of shipDestinations) {
      const margin = await quoteMargin({
        addressFrom: origin,
        addressTo: {
          name: line.recipientName ?? "Recipient",
          street1: line.addressLine1 ?? "",
          city: line.city ?? "",
          state: line.state ?? "",
          zip: line.postalCode ?? "",
          country: line.country ?? "US",
        },
        parcel,
      });
      shipQuotes.push({
        destinationKey: key,
        chargedCents: margin.chargedCents,
        purchasedCents: margin.purchasedCents,
        marginCents: margin.marginCents,
        chargeCarrier: margin.chargeRate.carrier,
        buyCarrier: margin.buyRate.carrier,
      });
      shipFeeCents += margin.chargedCents;
    }
  }

  const uniqueBlocked = [...new Set(blockedZips)];
  const bulkFeeCents = bulkDestinations.size * fees.bulkDestinationFeeCents;
  const perPackageFeeCents = perPackageRecipients.size * fees.perPackageFeeCents;

  return {
    bulkDestinationCount: bulkDestinations.size,
    bulkFeeCents,
    perPackageRecipientCount: perPackageRecipients.size,
    perPackageFeeCents,
    shipLineCount,
    shipFeeCents,
    totalFeeCents: bulkFeeCents + perPackageFeeCents + shipFeeCents,
    blockedZips: uniqueBlocked,
    shipQuotes,
    liveShip,
  };
}
