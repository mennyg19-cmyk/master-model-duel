import 'server-only';

import type { ExportDataset } from '@prisma/client';

import { db } from '../db';
import { csvAmount, csvDate } from './csv-write';
import { MARGIN_SUMMARY_ONLY, readMarginReport } from './margin-report';
import {
  COUNTED_ORDER_STATUSES,
  countedOrderFilter,
  readSeasonPerformance,
} from './season-performance';

/**
 * The five files the office takes out of the system (R-092).
 *
 * Every dataset answers the same three questions — what are the columns, how
 * many rows are there, and give me rows N to M — so the download route, the
 * export centre and the audit row all read one shape and none of them knows
 * what is in any particular file.
 *
 * Paging is not decoration. The deliveries file for a real Purim is five
 * thousand rows of addresses, and the route streams it a page at a time rather
 * than building the whole string in memory. The two aggregate files are tens of
 * rows by construction and answer the first page only.
 */
export type ExportDefinition = {
  dataset: ExportDataset;
  label: string;
  description: string;
  fileSlug: string;
  headers: string[];
  count: (seasonId: string) => Promise<number>;
  page: (seasonId: string, skip: number, take: number) => Promise<string[][]>;
};

const deliveries: ExportDefinition = {
  dataset: 'DELIVERIES',
  label: 'Deliveries',
  description: 'Every box in the season with its recipient, address and where it got to.',
  fileSlug: 'deliveries',
  headers: [
    'Order number',
    'Placed',
    'Customer',
    'Recipient',
    'Method',
    'Address line 1',
    'Address line 2',
    'City',
    'State',
    'ZIP',
    'Delivery day',
    'Stage',
    'Sent',
    'Tracking',
  ],
  count: (seasonId) => db.package.count({ where: { order: countedOrderFilter(seasonId) } }),
  page: async (seasonId, skip, take) => {
    const packages = await db.package.findMany({
      where: { order: countedOrderFilter(seasonId) },
      select: {
        recipientName: true,
        addressLine1: true,
        addressLine2: true,
        addressCity: true,
        addressState: true,
        addressPostalCode: true,
        deliveryDay: true,
        stage: true,
        sentAt: true,
        fulfillmentMethod: { select: { label: true } },
        order: {
          select: { orderNumber: true, placedAt: true, customer: { select: { fullName: true } } },
        },
        shipmentBoxes: { select: { trackingNumber: true } },
      },
      orderBy: [{ order: { orderNumber: 'asc' } }, { id: 'asc' }],
      skip,
      take,
    });

    return packages.map((box) => [
      box.order.orderNumber === null ? '' : String(box.order.orderNumber),
      csvDate(box.order.placedAt),
      box.order.customer?.fullName ?? '',
      box.recipientName,
      box.fulfillmentMethod.label,
      box.addressLine1 ?? '',
      box.addressLine2 ?? '',
      box.addressCity ?? '',
      box.addressState ?? '',
      box.addressPostalCode ?? '',
      box.deliveryDay ?? '',
      box.stage,
      csvDate(box.sentAt),
      box.shipmentBoxes
        .map((parcel) => parcel.trackingNumber)
        .filter((tracking): tracking is string => tracking !== null)
        .join(' '),
    ]);
  },
};

const yearEnd: ExportDefinition = {
  dataset: 'YEAR_END',
  label: 'Year end',
  description: 'One row per order: what it cost, what was paid and what is still owed.',
  fileSlug: 'year-end',
  headers: [
    'Order number',
    'Placed',
    'Customer',
    'Email',
    'Phone',
    'Subtotal',
    'Fulfillment fee',
    'Total',
    'Paid',
    'Outstanding',
    'Payment status',
    'Order status',
    'Packages',
  ],
  count: (seasonId) => db.order.count({ where: countedOrderFilter(seasonId) }),
  page: async (seasonId, skip, take) => {
    const orders = await db.order.findMany({
      where: countedOrderFilter(seasonId),
      select: {
        orderNumber: true,
        placedAt: true,
        subtotalCents: true,
        fulfillmentFeeCents: true,
        totalCents: true,
        amountPaidCents: true,
        paymentStatus: true,
        status: true,
        customer: { select: { fullName: true, email: true, phone: true } },
        _count: { select: { packages: true } },
      },
      orderBy: [{ orderNumber: 'asc' }, { id: 'asc' }],
      skip,
      take,
    });

    return orders.map((order) => [
      order.orderNumber === null ? '' : String(order.orderNumber),
      csvDate(order.placedAt),
      order.customer?.fullName ?? '',
      order.customer?.email ?? '',
      order.customer?.phone ?? '',
      csvAmount(order.subtotalCents),
      csvAmount(order.fulfillmentFeeCents),
      csvAmount(order.totalCents),
      csvAmount(order.amountPaidCents),
      csvAmount(Math.max(order.totalCents - order.amountPaidCents, 0)),
      order.paymentStatus,
      order.status,
      String(order._count.packages),
    ]);
  },
};

/** Kept next to the rows below: adding a metric means adding one here too. */
const METRIC_ROW_COUNT = 13;

const yearMetrics: ExportDefinition = {
  dataset: 'YEAR_METRICS',
  label: 'Year metrics',
  description: 'The season summary as name-and-value rows, including the shipping spread.',
  fileSlug: 'year-metrics',
  headers: ['Metric', 'Value'],
  count: async () => METRIC_ROW_COUNT,
  page: async (seasonId, skip) => {
    if (skip > 0) return [];

    const totals = (await readSeasonPerformance()).find((season) => season.seasonId === seasonId);
    if (!totals) return [];

    const margin = await readMarginReport(seasonId, MARGIN_SUMMARY_ONLY);

    return [
      ['Season', totals.label],
      ['Orders', String(totals.orderCount)],
      ['Customers', String(totals.customerCount)],
      ['Packages', String(totals.packageCount)],
      ['Subtotal', csvAmount(totals.subtotalCents)],
      ['Fulfillment fees', csvAmount(totals.feeCents)],
      ['Revenue', csvAmount(totals.revenueCents)],
      ['Paid', csvAmount(totals.paidCents)],
      ['Outstanding', csvAmount(totals.outstandingCents)],
      ['Refunded', csvAmount(totals.refundedCents)],
      ['Shipping charged', csvAmount(margin.summary.chargedCents)],
      ['Shipping paid to carriers', csvAmount(margin.summary.paidCents)],
      ['Shipping spread kept', csvAmount(margin.summary.marginCents)],
    ];
  },
};

const itemSales: ExportDefinition = {
  dataset: 'ITEM_SALES',
  label: 'Item sales',
  description: 'Units and money per catalog item, under the name it was sold as.',
  fileSlug: 'item-sales',
  headers: ['Item', 'Units', 'Gross', 'Lines'],
  // How many items sold, without the money: the row count is asked for before
  // the rows are, and totalling the season twice to answer it is wasted work.
  count: async (seasonId) =>
    (
      await db.orderLine.groupBy({
        by: ['productNameSnapshot'],
        where: { order: countedOrderFilter(seasonId) },
      })
    ).length,
  page: async (seasonId, skip) => (skip > 0 ? [] : itemSalesRows(seasonId)),
};

async function itemSalesRows(seasonId: string): Promise<string[][]> {
  const grouped = await db.orderLine.groupBy({
    by: ['productNameSnapshot'],
    where: { order: countedOrderFilter(seasonId) },
    _sum: { quantity: true, lineTotalCents: true },
    _count: { _all: true },
  });

  return grouped
    .sort((left, right) => (right._sum.lineTotalCents ?? 0) - (left._sum.lineTotalCents ?? 0))
    .map((row) => [
      row.productNameSnapshot,
      String(row._sum.quantity ?? 0),
      csvAmount(row._sum.lineTotalCents ?? 0),
      String(row._count._all),
    ]);
}

/**
 * Households that used to give and did not this year. The definition is exactly
 * that — an order in some other season, none in this one — so a customer who
 * has simply not ordered yet in an open season appears here, which is the
 * point: the list is what the follow-up call is made from.
 */
const lapsedCustomers: ExportDefinition = {
  dataset: 'LAPSED_CUSTOMERS',
  label: 'Lapsed customers',
  description: 'Gave in an earlier season, nothing in this one, with what they last gave.',
  fileSlug: 'lapsed-customers',
  headers: ['Customer', 'Email', 'Phone', 'Last season', 'Last order', 'Lifetime total', 'Orders'],
  count: (seasonId) => db.customer.count({ where: lapsedWhere(seasonId) }),
  page: async (seasonId, skip, take) => {
    const customers = await db.customer.findMany({
      where: lapsedWhere(seasonId),
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        orders: {
          where: { status: { in: COUNTED_ORDER_STATUSES } },
          select: { placedAt: true, season: { select: { label: true } } },
          orderBy: { placedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      skip,
      take,
    });

    // Lifetime money for this page only. Summing it inside the query above
    // would pull every order every customer has ever placed into memory to add
    // up two columns.
    const lifetime = await db.order.groupBy({
      by: ['customerId'],
      where: {
        customerId: { in: customers.map((customer) => customer.id) },
        status: { in: COUNTED_ORDER_STATUSES },
      },
      _sum: { totalCents: true },
      _count: { _all: true },
    });

    const byCustomer = new Map(lifetime.map((row) => [row.customerId, row]));

    return customers.map((customer) => {
      const totals = byCustomer.get(customer.id);

      return [
        customer.fullName,
        customer.email,
        customer.phone ?? '',
        customer.orders[0]?.season.label ?? '',
        csvDate(customer.orders[0]?.placedAt),
        csvAmount(totals?._sum.totalCents ?? 0),
        String(totals?._count._all ?? 0),
      ];
    });
  },
};

function lapsedWhere(seasonId: string) {
  return {
    orders: { some: { seasonId: { not: seasonId }, status: { in: COUNTED_ORDER_STATUSES } } },
    NOT: { orders: { some: { seasonId, status: { in: COUNTED_ORDER_STATUSES } } } },
  };
}

export const EXPORT_DEFINITIONS: ExportDefinition[] = [
  deliveries,
  yearEnd,
  yearMetrics,
  itemSales,
  lapsedCustomers,
];

export function findExportDefinition(slug: string): ExportDefinition | undefined {
  return EXPORT_DEFINITIONS.find((definition) => definition.fileSlug === slug);
}
