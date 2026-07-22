import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { csvLine } from "@/lib/csv";
import { seasonPerformance, seasonDrilldown } from "@/lib/reports";

// CSV export center datasets (R-092). Each dataset is an async generator of
// CSV lines so the API route can stream big results page by page instead of
// building one giant string (deliveries at 5k packages).

export const EXPORT_DATASETS = {
  deliveries: "Deliveries — every delivery/shipping package with address, stage, and route",
  "year-end": "Year-end orders — every finalized order for the season with totals and payment status",
  "year-metrics": "Year metrics — one summary row per season",
  "item-sales": "Item sales — per-product quantities and revenue for the season",
  "lapsed-customers": "Lapsed customers — ordered in a past season but not in the current one",
} as const;

export type ExportDataset = keyof typeof EXPORT_DATASETS;

export function isExportDataset(name: string): name is ExportDataset {
  return name in EXPORT_DATASETS;
}

const PAGE = 500;

async function* deliveriesCsv(seasonId: string): AsyncGenerator<string> {
  yield csvLine([
    "package_id", "recipient", "address", "city", "state", "zip",
    "method", "stage", "greeting", "route", "delivered_at",
  ]);
  let cursor: string | undefined;
  for (;;) {
    const page = await db.package.findMany({
      where: { seasonId, fulfillmentMethod: { kind: { in: ["BULK_DELIVERY", "PER_PACKAGE_DELIVERY", "SHIPPING"] } } },
      orderBy: { id: "asc" },
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        fulfillmentMethod: { select: { name: true } },
        routeStop: { include: { route: { select: { name: true } } } },
      },
    });
    if (page.length === 0) return;
    for (const pkg of page) {
      yield csvLine([
        pkg.id,
        pkg.recipientName,
        pkg.addressLine2 ? `${pkg.addressLine1}, ${pkg.addressLine2}` : pkg.addressLine1,
        pkg.city, pkg.state, pkg.zip,
        pkg.fulfillmentMethod.name,
        pkg.stage,
        pkg.greeting,
        pkg.routeStop?.route.name ?? "",
        pkg.routeStop?.deliveredAt?.toISOString() ?? "",
      ]);
    }
    cursor = page[page.length - 1].id;
  }
}

async function* yearEndCsv(seasonId: string): AsyncGenerator<string> {
  yield csvLine([
    "order_number", "customer", "email", "items_cents", "fees_cents",
    "donation_cents", "total_cents", "payment_status", "finalized_at",
  ]);
  let cursor: string | undefined;
  for (;;) {
    const page = await db.order.findMany({
      where: { seasonId, status: "FINALIZED" },
      orderBy: { id: "asc" },
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { customer: { select: { name: true, email: true } } },
    });
    if (page.length === 0) return;
    for (const order of page) {
      yield csvLine([
        order.orderNumber, order.customer.name, order.customer.email,
        order.itemsCents, order.feesCents, order.donationCents, order.totalCents,
        order.paymentStatus, order.finalizedAt?.toISOString() ?? "",
      ]);
    }
    cursor = page[page.length - 1].id;
  }
}

async function* yearMetricsCsv(): AsyncGenerator<string> {
  yield csvLine([
    "season", "status", "finalized_orders", "items_cents", "fees_cents", "donation_cents",
    "total_cents", "collected_cents", "paid_orders", "unpaid_orders", "packages",
  ]);
  for (const row of await seasonPerformance()) {
    yield csvLine([
      row.seasonName, row.seasonStatus, row.finalizedOrders, row.itemsCents, row.feesCents,
      row.donationCents, row.totalCents, row.collectedCents, row.paidOrders, row.unpaidOrders, row.packages,
    ]);
  }
}

async function* itemSalesCsv(seasonId: string): AsyncGenerator<string> {
  yield csvLine(["product", "quantity", "revenue_cents"]);
  const { items } = await seasonDrilldown(seasonId);
  for (const item of items) yield csvLine([item.productName, item.quantity, item.revenueCents]);
}

async function* lapsedCustomersCsv(currentSeasonId: string): AsyncGenerator<string> {
  yield csvLine(["customer", "email", "phone", "last_order_season", "last_order_at"]);
  // Set-based: one window ranks each customer's finalized orders, then we keep
  // rn=1 — no per-customer correlated subquery for the season name.
  const rows = await db.$queryRaw<
    { name: string; email: string; phone: string | null; seasonName: string; lastAt: Date }[]
  >(Prisma.sql`
    WITH last_orders AS (
      SELECT o."customerId",
             o."finalizedAt" AS "lastAt",
             se.name AS "seasonName",
             ROW_NUMBER() OVER (PARTITION BY o."customerId" ORDER BY o."finalizedAt" DESC) AS rn
      FROM "Order" o
      JOIN "Season" se ON se.id = o."seasonId"
      WHERE o.status = 'FINALIZED'
    )
    SELECT c.name, c.email, c.phone, lo."seasonName", lo."lastAt"
    FROM "Customer" c
    JOIN last_orders lo ON lo."customerId" = c.id AND lo.rn = 1
    WHERE NOT EXISTS (
      SELECT 1 FROM "Order" cur
      WHERE cur."customerId" = c.id AND cur."seasonId" = ${currentSeasonId} AND cur.status <> 'DISCARDED'
    )
    ORDER BY lo."lastAt" DESC
  `);
  for (const row of rows) {
    yield csvLine([row.name, row.email, row.phone, row.seasonName, row.lastAt?.toISOString() ?? ""]);
  }
}

/** Returns the CSV line generator for a dataset. seasonId is the report scope. */
export function exportCsv(dataset: ExportDataset, seasonId: string): AsyncGenerator<string> {
  switch (dataset) {
    case "deliveries": return deliveriesCsv(seasonId);
    case "year-end": return yearEndCsv(seasonId);
    case "year-metrics": return yearMetricsCsv();
    case "item-sales": return itemSalesCsv(seasonId);
    case "lapsed-customers": return lapsedCustomersCsv(seasonId);
  }
}
