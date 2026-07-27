import 'server-only';

import { sumCents } from '../core/money';
import { db } from '../db';
import { countedOrderFilter } from './season-performance';

/**
 * Charged versus paid, box by box (UR-003, G-006).
 *
 * P8 quotes every carrier, charges the customer the dearest eligible rate and
 * buys the label on the cheapest, and writes all three numbers onto the parcel.
 * This is the report that adds them up — the spread is what funds the campaign,
 * so somebody has to be able to point at the figure and follow it back to a
 * tracking number.
 *
 * Only purchased parcels count. A label that failed cost nothing and charged
 * nothing; a voided one was refunded by the carrier, and counting its spread
 * would book income the organisation gave back.
 *
 * A parcel with no `marginCents` is not treated as a zero. It is counted
 * separately as unpriced, because "we shipped six boxes for free" and "six
 * boxes are missing their rate" are different problems and only one of them is
 * an accounting error.
 */
export type MarginRow = {
  packageId: string;
  orderId: string;
  orderNumber: number | null;
  recipientName: string;
  carrier: string;
  serviceLabel: string;
  parcelCount: number;
  customerPriceCents: number;
  carrierCostCents: number;
  marginCents: number;
  purchasedAt: Date | null;
};

export type MarginSummary = {
  packageCount: number;
  parcelCount: number;
  chargedCents: number;
  paidCents: number;
  marginCents: number;
  /** Purchased parcels the carrier priced but nobody recorded a spread for. */
  unpricedParcelCount: number;
};

export type MarginReport = { rows: MarginRow[]; summary: MarginSummary };

/**
 * Ask for the season totals and none of the table under them. The year-metrics
 * export wants the three shipping figures and no parcel rows at all.
 */
export const MARGIN_SUMMARY_ONLY = 0;

export async function readMarginReport(seasonId: string, limit = 200): Promise<MarginReport> {
  const parcels = await db.shipmentBox.findMany({
    where: {
      status: 'PURCHASED',
      package: { order: countedOrderFilter(seasonId) },
    },
    select: {
      packageId: true,
      carrier: true,
      serviceLabel: true,
      customerPriceCents: true,
      carrierCostCents: true,
      marginCents: true,
      purchasedAt: true,
      package: {
        select: {
          recipientName: true,
          orderId: true,
          order: { select: { orderNumber: true } },
        },
      },
    },
    orderBy: { purchasedAt: 'desc' },
  });

  const byPackage = new Map<string, MarginRow>();

  for (const parcel of parcels) {
    const existing = byPackage.get(parcel.packageId);

    if (existing) {
      existing.parcelCount += 1;
      existing.customerPriceCents += parcel.customerPriceCents ?? 0;
      existing.carrierCostCents += parcel.carrierCostCents ?? 0;
      existing.marginCents += parcel.marginCents ?? 0;
      continue;
    }

    byPackage.set(parcel.packageId, {
      packageId: parcel.packageId,
      orderId: parcel.package.orderId,
      orderNumber: parcel.package.order.orderNumber,
      recipientName: parcel.package.recipientName,
      carrier: parcel.carrier ?? 'Unknown',
      serviceLabel: parcel.serviceLabel ?? '',
      parcelCount: 1,
      customerPriceCents: parcel.customerPriceCents ?? 0,
      carrierCostCents: parcel.carrierCostCents ?? 0,
      marginCents: parcel.marginCents ?? 0,
      purchasedAt: parcel.purchasedAt,
    });
  }

  const rows = [...byPackage.values()];

  return {
    rows: rows.slice(0, limit),
    summary: {
      packageCount: rows.length,
      parcelCount: parcels.length,
      chargedCents: sumCents(rows.map((row) => row.customerPriceCents)),
      paidCents: sumCents(rows.map((row) => row.carrierCostCents)),
      marginCents: sumCents(rows.map((row) => row.marginCents)),
      unpricedParcelCount: parcels.filter((parcel) => parcel.marginCents === null).length,
    },
  };
}
