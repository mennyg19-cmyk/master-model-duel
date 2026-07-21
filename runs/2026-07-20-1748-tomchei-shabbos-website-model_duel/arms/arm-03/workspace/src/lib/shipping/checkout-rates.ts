import { quoteMargin } from "@/lib/shipping/margin";
import { getShippoEnv } from "@/lib/shippo/client";
import {
  FULFILLMENT_CODES,
  addressOnlyKey,
  destinationKey,
  type CheckoutLineForFees,
  type DeliveryFeeBreakdown,
  type DeliveryFeeSettings,
} from "@/lib/checkout/delivery";
import { isDeliveryZipAllowed, normalizeZip } from "@/lib/storefront/settings-keys";
import {
  resolveParcelsForItems,
  type PackableItem,
} from "@/lib/shipping/bin-packing";

export type LiveShipQuote = {
  destinationKey: string;
  chargedCents: number;
  purchasedCents: number;
  marginCents: number;
  chargeCarrier: string;
  buyCarrier: string;
  parcelCount: number;
};

function shipItemsForDestination(
  lines: CheckoutLineForFees[],
  destKey: string,
): PackableItem[] {
  return lines
    .filter(
      (line) =>
        line.fulfillmentMethodCode === FULFILLMENT_CODES.SHIP &&
        destinationKey(line) === destKey,
    )
    .map((line) => ({
      id: line.id,
      sku: line.productSku ?? line.id,
      quantity: line.quantity ?? 1,
      weightOz: line.weightOz ?? 16,
      lengthIn: line.lengthIn ?? 8,
      widthIn: line.widthIn ?? 6,
      heightIn: line.heightIn ?? 4,
    }));
}

/**
 * Live Shippo rate-resolution for SHIP lines (replaces P5 placeholder).
 * One margin quote per unique ship destination; parcels from shared bin-pack
 * so checkout charge matches label purchase (B1/B2).
 */
export async function resolveDeliveryFeesLive(
  lines: CheckoutLineForFees[],
  fees: DeliveryFeeSettings,
  allowedZips: string[],
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
    const quoted = await Promise.all(
      [...shipDestinations.entries()].map(async ([key, line]) => {
        const items = shipItemsForDestination(lines, key);
        const { parcels } = await resolveParcelsForItems(items);
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
          parcels,
        });
        return {
          destinationKey: key,
          chargedCents: margin.chargedCents,
          purchasedCents: margin.purchasedCents,
          marginCents: margin.marginCents,
          chargeCarrier: margin.chargeRate.carrier,
          buyCarrier: margin.buyRate.carrier,
          parcelCount: parcels.length,
        } satisfies LiveShipQuote;
      }),
    );
    for (const quote of quoted) {
      shipQuotes.push(quote);
      shipFeeCents += quote.chargedCents;
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
