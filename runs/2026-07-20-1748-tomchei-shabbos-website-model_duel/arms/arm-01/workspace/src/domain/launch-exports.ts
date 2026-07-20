import type { PrismaClient } from "@prisma/client";
import { getLaunchReports } from "@/domain/launch-reporting";

export const exportDatasets = [
  "deliveries",
  "year-end",
  "year-metrics",
  "item-sales",
  "lapsed-customers",
] as const;
export type ExportDataset = (typeof exportDatasets)[number];
type ExportRow = Record<string, string | number | null>;

function protectSpreadsheetCell(value: string) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function quoteCsvCell(value: string | number | null) {
  const text = protectSpreadsheetCell(value === null ? "" : String(value));
  return `"${text.replaceAll('"', '""')}"`;
}

export function encodeCsv(rows: ExportRow[]) {
  if (!rows.length) return "\uFEFF";
  const headers = Object.keys(rows[0]);
  return `\uFEFF${[
    headers.map(quoteCsvCell).join(","),
    ...rows.map((row) =>
      headers.map((header) => quoteCsvCell(row[header] ?? null)).join(","),
    ),
  ].join("\r\n")}\r\n`;
}

export async function getExportRows(
  db: PrismaClient,
  dataset: ExportDataset,
  seasonId?: string,
): Promise<ExportRow[]> {
  if (dataset === "deliveries") {
    const packages = await db.package.findMany({
      where: {
        isActive: true,
        order: seasonId ? { seasonId } : undefined,
        fulfillmentMethod: {
          code: { in: ["DELIVERY", "PACKAGE_DELIVERY", "BULK_DELIVERY"] },
        },
      },
      orderBy: [{ order: { orderNumber: "asc" } }, { recipientName: "asc" }],
      select: {
        id: true,
        recipientName: true,
        stage: true,
        addressSnapshot: true,
        fulfillmentMethod: { select: { code: true } },
        order: {
          select: {
            orderNumber: true,
            season: { select: { name: true } },
            customer: { select: { displayName: true, email: true, phone: true } },
          },
        },
      },
      take: 25_000,
    });
    return packages.map((orderPackage) => ({
      season: orderPackage.order.season.name,
      orderNumber: orderPackage.order.orderNumber,
      packageId: orderPackage.id,
      customer: orderPackage.order.customer.displayName,
      email: orderPackage.order.customer.email,
      phone: orderPackage.order.customer.phone,
      recipient: orderPackage.recipientName,
      method: orderPackage.fulfillmentMethod.code,
      stage: orderPackage.stage,
      address: JSON.stringify(orderPackage.addressSnapshot ?? {}),
    }));
  }

  if (dataset === "year-end") {
    const orders = await db.order.findMany({
      where: { status: "FINALIZED", seasonId },
      orderBy: { orderNumber: "asc" },
      select: {
        orderNumber: true,
        totalCents: true,
        donationCents: true,
        cachedPaymentStatus: true,
        customer: { select: { displayName: true, email: true } },
        _count: { select: { packages: true } },
      },
      take: 25_000,
    });
    return orders.map((order) => ({
      orderNumber: order.orderNumber,
      customer: order.customer.displayName,
      email: order.customer.email,
      totalCents: order.totalCents,
      donationCents: order.donationCents,
      paymentStatus: order.cachedPaymentStatus,
      packageCount: order._count.packages,
    }));
  }

  const reports = await getLaunchReports(db);
  if (dataset === "year-metrics") {
    return reports.seasons
      .filter((season) => !seasonId || season.seasonId === seasonId)
      .map((season) => ({
        season: season.seasonName,
        year: season.year,
        orders: season.orderCount,
        customers: season.customerCount,
        revenueCents: season.revenueCents,
        donationCents: season.donationCents,
      }));
  }
  if (dataset === "item-sales") {
    return reports.seasons
      .filter((season) => !seasonId || season.seasonId === seasonId)
      .flatMap((season) =>
        season.itemSales.map((sale) => ({
          season: season.seasonName,
          year: season.year,
          sku: sale.sku,
          product: sale.name,
          quantity: sale.quantity,
          revenueCents: sale.revenueCents,
        })),
      );
  }

  const selectedSeason = seasonId
    ? await db.season.findUnique({ where: { id: seasonId }, select: { year: true } })
    : await db.season.findFirst({ orderBy: { year: "desc" }, select: { id: true, year: true } });
  if (!selectedSeason) return [];
  const customers = await db.customer.findMany({
    where: {
      orders: { some: { status: "FINALIZED", season: { year: { lt: selectedSeason.year } } } },
      NOT: { orders: { some: { status: "FINALIZED", season: { year: selectedSeason.year } } } },
    },
    orderBy: { displayName: "asc" },
    select: {
      displayName: true,
      email: true,
      phone: true,
      orders: {
        where: { status: "FINALIZED" },
        orderBy: { season: { year: "desc" } },
        take: 1,
        select: { season: { select: { year: true } }, totalCents: true },
      },
    },
    take: 25_000,
  });
  return customers.map((customer) => ({
    customer: customer.displayName,
    email: customer.email,
    phone: customer.phone,
    lastSeason: customer.orders[0]?.season.year ?? null,
    lastOrderCents: customer.orders[0]?.totalCents ?? null,
  }));
}
