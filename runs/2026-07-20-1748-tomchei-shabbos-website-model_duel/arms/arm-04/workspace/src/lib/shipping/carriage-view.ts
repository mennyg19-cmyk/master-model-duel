import 'server-only';

import type { PackageStage, ShippingLabelStatus, ShippingQuoteSource } from '@prisma/client';

import type { DbClient } from '../core/db-client';
import { boardScopeWhere } from '../fulfillment/channel-summary';
import { isLabelBought, isLabelVoidable } from './label-status';

/**
 * What the packing table sees about a box's carriage: the labels on it, the
 * rates the last quote came back with, and whether the carrier recognises the
 * address (UR-003, R-177).
 *
 * A read model of its own rather than more fields on `PackageDetail`, because
 * every other box on the board is a delivery or a pickup and has no carriage at
 * all — this is only ever asked for on a shipping box.
 */
export type CarriageParcel = {
  id: string;
  parcelIndex: number;
  status: ShippingLabelStatus;
  carrier: string | null;
  serviceLabel: string | null;
  weightGrams: number;
  boxTypeName: string | null;
  trackingNumber: string | null;
  trackingStatus: string | null;
  trackingCheckedAt: Date | null;
  labelUrl: string | null;
  carrierCostCents: number | null;
  customerPriceCents: number | null;
  marginCents: number | null;
  failureMessage: string | null;
  voidReason: string | null;
  purchasedAt: Date | null;
};

export type CarriageQuoteOption = {
  carrier: string;
  serviceLabel: string;
  carrierCostCents: number;
  transitDays: number | null;
  isSelected: boolean;
  isEligible: boolean;
};

export type CarriageCard = {
  packageId: string;
  stage: PackageStage;
  parcels: CarriageParcel[];
  hasLiveLabel: boolean;
  canVoid: boolean;
  address: {
    checkedAt: Date | null;
    isValid: boolean | null;
    note: string | null;
  };
  quote: {
    requestedAt: Date;
    source: ShippingQuoteSource;
    parcelCount: number;
    billableWeightGrams: number;
    customerPriceCents: number;
    options: CarriageQuoteOption[];
  } | null;
};

/** Null when the box is not on this season's board. */
export async function readCarriageCard(
  client: DbClient,
  seasonId: string,
  packageId: string,
): Promise<CarriageCard | null> {
  const box = await client.package.findFirst({
    where: { id: packageId, ...boardScopeWhere(seasonId) },
    select: {
      id: true,
      stage: true,
      addressValidatedAt: true,
      addressIsValid: true,
      addressValidationNote: true,
      shipmentBoxes: {
        orderBy: [{ parcelIndex: 'asc' }, { createdAt: 'asc' }],
        include: { packageType: { select: { name: true } } },
      },
      shippingQuotes: {
        orderBy: { requestedAt: 'desc' },
        take: 1,
        include: { options: { orderBy: { carrierCostCents: 'asc' } } },
      },
    },
  });

  if (!box) return null;

  const quote = box.shippingQuotes[0] ?? null;

  return {
    packageId: box.id,
    stage: box.stage,
    parcels: box.shipmentBoxes.map((parcel) => ({
      id: parcel.id,
      parcelIndex: parcel.parcelIndex,
      status: parcel.status,
      carrier: parcel.carrier,
      serviceLabel: parcel.serviceLabel,
      weightGrams: parcel.weightGrams,
      boxTypeName: parcel.packageType?.name ?? null,
      trackingNumber: parcel.trackingNumber,
      trackingStatus: parcel.trackingStatus,
      trackingCheckedAt: parcel.trackingCheckedAt,
      labelUrl: printableLabelUrl(parcel.labelUrl),
      carrierCostCents: parcel.carrierCostCents,
      customerPriceCents: parcel.customerPriceCents,
      marginCents: parcel.marginCents,
      failureMessage: parcel.failureMessage,
      voidReason: parcel.voidReason,
      purchasedAt: parcel.purchasedAt,
    })),
    hasLiveLabel: box.shipmentBoxes.some((parcel) => isLabelBought(parcel.status)),
    canVoid: isLabelVoidable(box.stage) && box.shipmentBoxes.some((parcel) => isLabelBought(parcel.status)),
    address: {
      checkedAt: box.addressValidatedAt,
      isValid: box.addressIsValid,
      note: box.addressValidationNote,
    },
    quote: quote && {
      requestedAt: quote.requestedAt,
      source: quote.source,
      parcelCount: quote.parcelCount,
      billableWeightGrams: quote.billableWeightGrams,
      customerPriceCents: quote.customerPriceCents,
      options: quote.options.map((option) => ({
        carrier: option.carrier,
        serviceLabel: option.serviceLabel,
        carrierCostCents: option.carrierCostCents,
        transitDays: option.transitDays,
        isSelected: option.isSelected,
        isEligible: option.isEligible,
      })),
    },
  };
}

/**
 * A label URL is a bearer token the carrier minted, and it arrives from outside
 * this application. Only an `https` document is offered as a link, so a
 * provider that answered with `javascript:` or `data:` cannot put that behind a
 * button on the packing board.
 */
function printableLabelUrl(url: string | null): string | null {
  if (!url) return null;

  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
