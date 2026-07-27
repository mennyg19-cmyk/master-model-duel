import 'server-only';

import type { OrderStatus, PaymentMethod, SeasonStatus } from '@prisma/client';

import { db } from '../db';

/**
 * What each campaign year actually did (R-091).
 *
 * One rule decides what counts, and it is written once here: an order counts
 * from the moment it is placed until somebody cancels it. Drafts are shopping
 * baskets, cancelled and discarded orders are not income, and a report that
 * quietly included either would disagree with the order desk by exactly the
 * number of abandoned carts.
 *
 * Every figure comes from a grouped query rather than from rows read into
 * memory. At five thousand packages a report that loads the season to add it up
 * is a report nobody runs twice.
 */
export const COUNTED_ORDER_STATUSES: OrderStatus[] = ['PLACED', 'IN_FULFILLMENT', 'COMPLETED'];

/** "The orders of this season that count", spelled once for every report. */
export function countedOrderFilter(seasonId: string) {
  return { seasonId, status: { in: COUNTED_ORDER_STATUSES } };
}

export type SeasonTotals = {
  seasonId: string;
  year: number;
  label: string;
  status: SeasonStatus;
  orderCount: number;
  customerCount: number;
  packageCount: number;
  subtotalCents: number;
  feeCents: number;
  revenueCents: number;
  paidCents: number;
  outstandingCents: number;
  refundedCents: number;
};

export async function readSeasonPerformance(): Promise<SeasonTotals[]> {
  const seasons = await db.season.findMany({ orderBy: { year: 'desc' } });

  const grouped = await db.order.groupBy({
    by: ['seasonId'],
    where: { status: { in: COUNTED_ORDER_STATUSES } },
    _count: { _all: true },
    _sum: {
      subtotalCents: true,
      fulfillmentFeeCents: true,
      totalCents: true,
      amountPaidCents: true,
    },
  });

  const money = new Map(grouped.map((row) => [row.seasonId, row]));

  return Promise.all(
    seasons.map(async (season) => {
      const totals = money.get(season.id);

      // Distinct households and box counts cannot come out of the grouped query
      // above — one has to be counted by the database, the other hangs off the
      // order rather than the season — so each is its own bounded count.
      const [customerCount, packageCount, refunded] = await Promise.all([
        db.customer.count({
          where: { orders: { some: { seasonId: season.id, status: { in: COUNTED_ORDER_STATUSES } } } },
        }),
        db.package.count({
          where: { order: { seasonId: season.id, status: { in: COUNTED_ORDER_STATUSES } } },
        }),
        db.paymentRefund.aggregate({
          where: { payment: { order: { seasonId: season.id } } },
          _sum: { amountCents: true },
        }),
      ]);

      const revenueCents = totals?._sum.totalCents ?? 0;
      const paidCents = totals?._sum.amountPaidCents ?? 0;

      return {
        seasonId: season.id,
        year: season.year,
        label: season.label,
        status: season.status,
        orderCount: totals?._count._all ?? 0,
        customerCount,
        packageCount,
        subtotalCents: totals?._sum.subtotalCents ?? 0,
        feeCents: totals?._sum.fulfillmentFeeCents ?? 0,
        revenueCents,
        paidCents,
        outstandingCents: Math.max(revenueCents - paidCents, 0),
        refundedCents: refunded._sum.amountCents ?? 0,
      };
    }),
  );
}

export type ProductSales = {
  productName: string;
  units: number;
  grossCents: number;
  lineCount: number;
};

export type MethodBreakdown = {
  methodLabel: string;
  kind: string;
  packageCount: number;
  feeCents: number;
};

export type PaymentBreakdown = {
  method: PaymentMethod;
  paymentCount: number;
  amountCents: number;
};

export type StatusBreakdown = { status: OrderStatus; orderCount: number; totalCents: number };

export type SeasonDrilldown = {
  totals: SeasonTotals;
  byProduct: ProductSales[];
  byMethod: MethodBreakdown[];
  byPaymentMethod: PaymentBreakdown[];
  byStatus: StatusBreakdown[];
};

/**
 * The four questions the office asks after "how did the year go": what sold,
 * how it travelled, how it was paid for, and where the orders are now.
 *
 * Products are grouped on the snapshot name rather than the product id on
 * purpose — that is the name the customer bought under, and a box renamed
 * between seasons would otherwise split its own sales in two.
 */
export async function readSeasonDrilldown(seasonId: string): Promise<SeasonDrilldown | null> {
  const totals = (await readSeasonPerformance()).find((season) => season.seasonId === seasonId);
  if (!totals) return null;

  const countedOrder = countedOrderFilter(seasonId);

  const [products, packages, payments, statuses, methods] = await Promise.all([
    db.orderLine.groupBy({
      by: ['productNameSnapshot'],
      where: { order: countedOrder },
      _sum: { quantity: true, lineTotalCents: true },
      _count: { _all: true },
    }),
    db.package.groupBy({
      by: ['fulfillmentMethodId'],
      where: { order: countedOrder },
      _sum: { fulfillmentFeeCents: true },
      _count: { _all: true },
    }),
    db.payment.groupBy({
      by: ['method'],
      where: { state: 'POSTED', order: { seasonId } },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    db.order.groupBy({
      by: ['status'],
      where: { seasonId },
      _sum: { totalCents: true },
      _count: { _all: true },
    }),
    db.fulfillmentMethod.findMany({ select: { id: true, label: true, kind: true } }),
  ]);

  const methodsById = new Map(methods.map((method) => [method.id, method]));

  return {
    totals,
    byProduct: products
      .map((row) => ({
        productName: row.productNameSnapshot,
        units: row._sum.quantity ?? 0,
        grossCents: row._sum.lineTotalCents ?? 0,
        lineCount: row._count._all,
      }))
      .sort((left, right) => right.grossCents - left.grossCents),
    byMethod: packages
      .map((row) => ({
        methodLabel: methodsById.get(row.fulfillmentMethodId)?.label ?? 'Unknown method',
        kind: methodsById.get(row.fulfillmentMethodId)?.kind ?? 'UNKNOWN',
        packageCount: row._count._all,
        feeCents: row._sum.fulfillmentFeeCents ?? 0,
      }))
      .sort((left, right) => right.packageCount - left.packageCount),
    byPaymentMethod: payments
      .map((row) => ({
        method: row.method,
        paymentCount: row._count._all,
        amountCents: row._sum.amountCents ?? 0,
      }))
      .sort((left, right) => right.amountCents - left.amountCents),
    byStatus: statuses
      .map((row) => ({
        status: row.status,
        orderCount: row._count._all,
        totalCents: row._sum.totalCents ?? 0,
      }))
      .sort((left, right) => right.orderCount - left.orderCount),
  };
}
