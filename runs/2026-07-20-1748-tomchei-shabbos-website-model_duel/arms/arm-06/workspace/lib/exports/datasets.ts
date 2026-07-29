import { prisma } from "@/lib/db";
import { Permission } from "@/lib/permissions";
import { CHANNEL_LABELS } from "@/lib/packages/fulfillment";

// R-092: the export center datasets. Each dataset owns its header, its
// permission, and a paged row generator — the route streams pages straight
// into CSV chunks, so a large export never buffers the whole table. Money is
// integer cents rendered as dollars at the CSV edge (the cell IS the
// presentation, so the cents↔dollars conversion point lives here for exports).

export type ExportDatasetKey = "deliveries" | "year-end" | "year-metrics" | "item-sales" | "lapsed-customers";

export interface ExportParams {
  seasonId?: string;
}

export interface ExportDataset {
  key: ExportDatasetKey;
  label: string;
  description: string;
  permission: Permission;
  /** Whether the dataset takes a season filter. */
  seasonScoped: boolean;
  header: string[];
  filename(params: ExportParams, seasonName?: string): string;
  rows(params: ExportParams): AsyncGenerator<(string | number | null)[]>;
}

const PAGE = 500;

function dollars(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toFixed(2);
}

// Formula-injection guard at the export edge: recipient/customer names and
// emails are user-controlled, and a text cell starting with = + - @ or a tab
// executes when staff open the CSV in Excel. Prefix with an apostrophe so
// spreadsheet apps render it as literal text. Numbers pass through — they
// are typed cells, not text.
function safeText(value: string | number | null): string | number | null {
  return typeof value === "string" && /^[=+\-@\t]/.test(value) ? `'${value}` : value;
}

async function* paged<T extends { id: string }>(
  fetchPage: (cursor?: string) => Promise<T[]>,
  mapRow: (row: T) => (string | number | null)[],
): AsyncGenerator<(string | number | null)[]> {
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    for (const row of page) yield mapRow(row).map(safeText);
    if (page.length < PAGE) return;
    cursor = page[page.length - 1].id;
  }
}

// -- deliveries: per-recipient fulfillment ledger for one season -------------
const deliveries: ExportDataset = {
  key: "deliveries",
  label: "Deliveries",
  description: "Every finalized recipient: channel, day, fee, address, package stage.",
  permission: "fulfillment.manage",
  seasonScoped: true,
  header: ["order", "customer_email", "customer_name", "recipient", "channel", "delivery_day", "fee_dollars", "line1", "line2", "city", "region", "postal_code", "country", "package_stage"],
  filename: (_params, seasonName) => `deliveries-${seasonName ?? "season"}.csv`,
  rows: async function* (params) {
    yield* paged(
      (cursor) =>
        prisma.draftRecipient.findMany({
          where: { order: { seasonId: params.seasonId, status: "FINALIZED" } },
          orderBy: { id: "asc" },
          take: PAGE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: {
            id: true,
            name: true,
            line1: true,
            line2: true,
            city: true,
            region: true,
            postalCode: true,
            country: true,
            fulfillmentChoice: true,
            deliveryDay: true,
            deliveryFeeCents: true,
            order: {
              select: {
                orderNumber: true,
                draftRef: true,
                customer: { select: { email: true, name: true } },
                packages: { select: { stage: true, recipientName: true, recipientAddress: { select: { line1: true, postalCode: true } } } },
              },
            },
          },
        }),
      (row) => {
        // Package stage lookup keys on the full recipient identity (name +
        // address), not name alone: one order can hold two same-name
        // recipients at different addresses (the P2 grouping key allows it),
        // and a name-only `find` would pin both rows to the first package.
        const candidates = row.order.packages.filter((candidate) => candidate.recipientName === row.name);
        const pkg =
          candidates.find(
            (candidate) =>
              candidate.recipientAddress !== null &&
              candidate.recipientAddress.line1 === row.line1 &&
              candidate.recipientAddress.postalCode === row.postalCode,
          ) ?? candidates[0];
        return [
          row.order.orderNumber === null ? (row.order.draftRef ?? "") : `#${row.order.orderNumber}`,
          row.order.customer.email,
          row.order.customer.name,
          row.name,
          row.fulfillmentChoice ? CHANNEL_LABELS[row.fulfillmentChoice] : "",
          row.deliveryDay ?? "",
          dollars(row.deliveryFeeCents),
          row.line1,
          row.line2 ?? "",
          row.city,
          row.region,
          row.postalCode,
          row.country,
          pkg?.stage ?? "",
        ];
      },
    );
  },
};

// -- year-end: per-order money ledger for one season --------------------------
const yearEnd: ExportDataset = {
  key: "year-end",
  label: "Year-end orders",
  description: "Per-order money: total, paid, balance, methods, status.",
  permission: "payments.manage",
  seasonScoped: true,
  header: ["order", "customer_email", "customer_name", "total_dollars", "paid_dollars", "balance_dollars", "payment_status", "methods", "created_at"],
  filename: (_params, seasonName) => `year-end-${seasonName ?? "season"}.csv`,
  rows: async function* (params) {
    yield* paged(
      (cursor) =>
        prisma.order.findMany({
          where: { seasonId: params.seasonId, status: "FINALIZED" },
          orderBy: { id: "asc" },
          take: PAGE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: {
            id: true,
            orderNumber: true,
            draftRef: true,
            totalCents: true,
            paymentStatus: true,
            createdAt: true,
            customer: { select: { email: true, name: true } },
            payments: { where: { status: "POSTED" }, select: { amountCents: true, method: true } },
          },
        }),
      (row) => {
        const paid = row.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
        const methods = [...new Set(row.payments.map((payment) => payment.method))].join("|");
        // Legacy refunded orders import as PAID-with-no-payment-rows (terminal
        // state, money already returned in the old system). Reporting the
        // cached PAID here would show a "paid" order with $0.00 collected and
        // a full balance — the accountant-facing label is REFUNDED.
        const statusLabel = row.paymentStatus === "PAID" && row.payments.length === 0 ? "REFUNDED" : row.paymentStatus;
        return [
          row.orderNumber === null ? (row.draftRef ?? "") : `#${row.orderNumber}`,
          row.customer.email,
          row.customer.name,
          dollars(row.totalCents),
          dollars(paid),
          dollars(row.totalCents - paid),
          statusLabel,
          methods,
          row.createdAt.toISOString().slice(0, 10),
        ];
      },
    );
  },
};

// -- year-metrics: one rollup row per season ----------------------------------
const yearMetrics: ExportDataset = {
  key: "year-metrics",
  label: "Year metrics",
  description: "Per-season rollup: orders, packages, revenue, fees, shipping margin.",
  permission: "payments.manage",
  seasonScoped: false,
  header: ["season", "status", "orders", "packages", "revenue_dollars", "delivery_fees_dollars", "shipping_charged_dollars", "shipping_cost_dollars", "shipping_margin_dollars"],
  filename: () => "year-metrics.csv",
  rows: async function* () {
    const seasons = await prisma.season.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    for (const season of seasons) {
      const [orders, packages, revenue, fees, shipping] = await Promise.all([
        prisma.order.count({ where: { seasonId: season.id, status: "FINALIZED" } }),
        prisma.package.count({ where: { order: { seasonId: season.id, status: "FINALIZED" } } }),
        prisma.payment.aggregate({ where: { order: { seasonId: season.id }, status: "POSTED" }, _sum: { amountCents: true } }),
        prisma.draftRecipient.aggregate({ where: { order: { seasonId: season.id, status: "FINALIZED" } }, _sum: { deliveryFeeCents: true } }),
        prisma.shipment.aggregate({
          where: { package: { order: { seasonId: season.id } }, status: "PURCHASED" },
          _sum: { chargedCents: true, costCents: true, marginCents: true },
        }),
      ]);
      yield [
        season.name,
        season.status,
        orders,
        packages,
        dollars(revenue._sum.amountCents),
        dollars(fees._sum.deliveryFeeCents),
        dollars(shipping._sum.chargedCents),
        dollars(shipping._sum.costCents),
        dollars(shipping._sum.marginCents),
      ].map(safeText);
    }
  },
};

// -- item-sales: per product/add-on units + revenue for one season ------------
const itemSales: ExportDataset = {
  key: "item-sales",
  label: "Item sales",
  description: "Units and revenue per product and add-on for a season.",
  permission: "payments.manage",
  seasonScoped: true,
  header: ["kind", "item", "units", "revenue_dollars"],
  filename: (_params, seasonName) => `item-sales-${seasonName ?? "season"}.csv`,
  rows: async function* (params) {
    // Snapshot names group honestly: a renamed item lands under the name the
    // buyer saw at checkout, which is what a sales ledger must say.
    const [products, addOns] = await Promise.all([
      prisma.orderLine.groupBy({
        by: ["productName"],
        where: { order: { seasonId: params.seasonId, status: "FINALIZED" }, productId: { not: null } },
        _sum: { qty: true, lineTotalCents: true },
        orderBy: { productName: "asc" },
      }),
      prisma.orderLine.groupBy({
        by: ["productName"],
        where: { order: { seasonId: params.seasonId, status: "FINALIZED" }, addOnId: { not: null } },
        _sum: { qty: true, lineTotalCents: true },
        orderBy: { productName: "asc" },
      }),
    ]);
    for (const row of products) yield ["product", row.productName, row._sum.qty ?? 0, dollars(row._sum.lineTotalCents)].map(safeText);
    for (const row of addOns) yield ["add-on", row.productName, row._sum.qty ?? 0, dollars(row._sum.lineTotalCents)].map(safeText);
  },
};

// -- lapsed-customers: ordered before, silent in the open season --------------
const lapsedCustomers: ExportDataset = {
  key: "lapsed-customers",
  label: "Lapsed customers",
  description: "Customers with finalized history who have not ordered in the current open season.",
  permission: "payments.manage",
  seasonScoped: false,
  header: ["customer_email", "customer_name", "last_season", "last_order_at", "lifetime_orders", "lifetime_order_total_dollars"],
  filename: () => "lapsed-customers.csv",
  rows: async function* () {
    const openSeason = await prisma.season.findFirst({ where: { status: "OPEN" } });
    yield* paged(
      (cursor) =>
        prisma.customer.findMany({
          where: openSeason
            ? {
                AND: [
                  { orders: { some: { status: "FINALIZED", seasonId: { not: openSeason.id } } } },
                  { orders: { none: { seasonId: openSeason.id, status: "FINALIZED" } } },
                ],
              }
            : { orders: { some: { status: "FINALIZED" } } },
          orderBy: { id: "asc" },
          take: PAGE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: {
            id: true,
            email: true,
            name: true,
            orders: {
              where: { status: "FINALIZED" },
              orderBy: [{ createdAt: "desc" }],
              select: { createdAt: true, totalCents: true, season: { select: { name: true } } },
            },
          },
        }),
      (row) => {
        const last = row.orders[0];
        // Lifetime order total, not "revenue": the reports vocabulary reserves
        // that word for POSTED payments (the payment ledger is the money
        // truth), so this column is labeled for what it actually sums.
        const orderTotal = row.orders.reduce((sum, order) => sum + order.totalCents, 0);
        return [
          row.email,
          row.name,
          last?.season.name ?? "",
          last ? last.createdAt.toISOString().slice(0, 10) : "",
          row.orders.length,
          dollars(orderTotal),
        ];
      },
    );
  },
};

export const EXPORT_DATASETS: Record<ExportDatasetKey, ExportDataset> = {
  deliveries,
  "year-end": yearEnd,
  "year-metrics": yearMetrics,
  "item-sales": itemSales,
  "lapsed-customers": lapsedCustomers,
};

export const EXPORT_DATASET_LIST = Object.values(EXPORT_DATASETS);
