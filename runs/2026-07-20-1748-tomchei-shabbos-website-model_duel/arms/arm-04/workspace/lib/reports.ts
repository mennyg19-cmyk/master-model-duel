import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// Reporting queries (P12, R-091, UR-003 report). Everything here is aggregate
// SQL — no row-walking — so the pages stay fast at the 1k-order scale baseline.

export type SeasonPerformanceRow = {
  seasonId: string;
  seasonName: string;
  seasonStatus: string;
  finalizedOrders: number;
  itemsCents: number;
  feesCents: number;
  donationCents: number;
  totalCents: number;
  collectedCents: number;
  paidOrders: number;
  unpaidOrders: number;
  packages: number;
};

export async function seasonPerformance(): Promise<SeasonPerformanceRow[]> {
  const seasons = await db.season.findMany({ orderBy: { createdAt: "desc" } });

  const [orderTotals, paymentStatusCounts, packageCounts, collected] = await Promise.all([
    db.order.groupBy({
      by: ["seasonId"],
      where: { status: "FINALIZED" },
      _count: { _all: true },
      _sum: { itemsCents: true, feesCents: true, donationCents: true, totalCents: true },
    }),
    db.order.groupBy({
      by: ["seasonId", "paymentStatus"],
      where: { status: "FINALIZED" },
      _count: { _all: true },
    }),
    db.package.groupBy({ by: ["seasonId"], _count: { _all: true } }),
    // Collected money = posted payments (refunds are negative rows, so this is net).
    db.$queryRaw<{ seasonId: string; collected: bigint }[]>(Prisma.sql`
      SELECT o."seasonId" AS "seasonId", COALESCE(SUM(p."amountCents"), 0) AS collected
      FROM "Payment" p JOIN "Order" o ON o.id = p."orderId"
      WHERE p.state = 'POSTED'
      GROUP BY o."seasonId"
    `),
  ]);

  const totalsBySeason = new Map(orderTotals.map((row) => [row.seasonId, row]));
  const collectedBySeason = new Map(collected.map((row) => [row.seasonId, Number(row.collected)]));
  const packagesBySeason = new Map(packageCounts.map((row) => [row.seasonId, row._count._all]));
  const statusBySeason = new Map<string, { paid: number; unpaid: number }>();
  for (const row of paymentStatusCounts) {
    const entry = statusBySeason.get(row.seasonId) ?? { paid: 0, unpaid: 0 };
    if (row.paymentStatus === "PAID" || row.paymentStatus === "COMPED") entry.paid += row._count._all;
    else entry.unpaid += row._count._all;
    statusBySeason.set(row.seasonId, entry);
  }

  return seasons.map((season) => {
    const totals = totalsBySeason.get(season.id);
    const status = statusBySeason.get(season.id) ?? { paid: 0, unpaid: 0 };
    return {
      seasonId: season.id,
      seasonName: season.name,
      seasonStatus: season.status,
      finalizedOrders: totals?._count._all ?? 0,
      itemsCents: totals?._sum.itemsCents ?? 0,
      feesCents: totals?._sum.feesCents ?? 0,
      donationCents: totals?._sum.donationCents ?? 0,
      totalCents: totals?._sum.totalCents ?? 0,
      collectedCents: collectedBySeason.get(season.id) ?? 0,
      paidOrders: status.paid,
      unpaidOrders: status.unpaid,
      packages: packagesBySeason.get(season.id) ?? 0,
    };
  });
}

export type MethodBreakdownRow = {
  methodName: string;
  packages: number;
  delivered: number;
  lineRevenueCents: number;
};

export type ItemSalesRow = {
  productName: string;
  quantity: number;
  revenueCents: number;
};

/** Drill-down for one season: per-fulfillment-method + per-product breakdowns. */
export async function seasonDrilldown(seasonId: string) {
  const [methodRows, itemRows] = await Promise.all([
    db.$queryRaw<
      { methodName: string; packages: bigint; delivered: bigint; lineRevenueCents: bigint }[]
    >(Prisma.sql`
      SELECT m.name AS "methodName",
             COUNT(DISTINCT pkg.id) AS packages,
             COUNT(DISTINCT pkg.id) FILTER (WHERE pkg.stage IN ('SENT', 'PICKED_UP')) AS delivered,
             COALESCE(SUM(l.quantity * l."unitPriceCents"), 0) AS "lineRevenueCents"
      FROM "FulfillmentMethod" m
      LEFT JOIN "Package" pkg ON pkg."fulfillmentMethodId" = m.id AND pkg."seasonId" = ${seasonId}
      LEFT JOIN "OrderLine" l ON l."packageId" = pkg.id
      GROUP BY m.id, m.name, m."sortOrder"
      ORDER BY m."sortOrder"
    `),
    db.$queryRaw<{ productName: string; quantity: bigint; revenueCents: bigint }[]>(Prisma.sql`
      SELECT p.name AS "productName",
             COALESCE(SUM(l.quantity), 0) AS quantity,
             COALESCE(SUM(l.quantity * l."unitPriceCents"), 0) AS "revenueCents"
      FROM "OrderLine" l
      JOIN "Order" o ON o.id = l."orderId" AND o.status = 'FINALIZED' AND o."seasonId" = ${seasonId}
      JOIN "Product" p ON p.id = l."productId"
      GROUP BY p.id, p.name
      ORDER BY "revenueCents" DESC
    `),
  ]);

  return {
    methods: methodRows.map<MethodBreakdownRow>((row) => ({
      methodName: row.methodName,
      packages: Number(row.packages),
      delivered: Number(row.delivered),
      lineRevenueCents: Number(row.lineRevenueCents),
    })),
    items: itemRows.map<ItemSalesRow>((row) => ({
      productName: row.productName,
      quantity: Number(row.quantity),
      revenueCents: Number(row.revenueCents),
    })),
  };
}

export type MarginReportRow = {
  shipmentId: string;
  createdAt: Date;
  seasonName: string;
  recipientName: string;
  carrier: string;
  service: string;
  orderNumber: number | null;
  chargedCents: number;
  costCents: number;
  marginCents: number;
};

export type MarginReport = {
  rows: MarginReportRow[];
  totals: { seasonName: string; shipments: number; chargedCents: number; costCents: number; marginCents: number }[];
};

// Shipping-margin reconciliation (UR-003 report): what the customer was
// charged vs what we paid the carrier, per purchased (non-voided) label.
export async function marginReport(limit = 200): Promise<MarginReport> {
  const [shipments, totals] = await Promise.all([
    db.shipment.findMany({
      where: { status: "PURCHASED" },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        package: {
          select: {
            recipientName: true,
            season: { select: { name: true } },
            lines: { select: { order: { select: { orderNumber: true } } }, take: 1 },
          },
        },
      },
    }),
    db.$queryRaw<
      { seasonName: string; shipments: bigint; charged: bigint; cost: bigint; margin: bigint }[]
    >(Prisma.sql`
      SELECT se.name AS "seasonName",
             COUNT(*) AS shipments,
             SUM(s."chargedCents") AS charged,
             SUM(s."costCents") AS cost,
             SUM(s."marginCents") AS margin
      FROM "Shipment" s
      JOIN "Package" pkg ON pkg.id = s."packageId"
      JOIN "Season" se ON se.id = pkg."seasonId"
      WHERE s.status = 'PURCHASED'
      GROUP BY se.id, se.name
      ORDER BY se.name DESC
    `),
  ]);

  return {
    rows: shipments.map((shipment) => ({
      shipmentId: shipment.id,
      createdAt: shipment.createdAt,
      seasonName: shipment.package.season.name,
      recipientName: shipment.package.recipientName,
      carrier: shipment.carrier,
      service: shipment.service,
      orderNumber: shipment.package.lines[0]?.order.orderNumber ?? null,
      chargedCents: shipment.chargedCents,
      costCents: shipment.costCents,
      marginCents: shipment.marginCents,
    })),
    totals: totals.map((row) => ({
      seasonName: row.seasonName,
      shipments: Number(row.shipments),
      chargedCents: Number(row.charged),
      costCents: Number(row.cost),
      marginCents: Number(row.margin),
    })),
  };
}
