import type { Metadata } from "next";
import { OrderStatus, PaymentStatus } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOpenSeason } from "@/lib/seasons/queries";
import {
  buildListHref,
  buildOrderWhere,
  clampPage,
  LIST_PAGE_SIZES,
  pageCount,
  parseOrderListParams,
} from "@/lib/admin/order-list";
import { formatCents } from "@/lib/money";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PaginationNav } from "@/components/admin/pagination-nav";
import { OrderListTable, OrderListRow } from "@/app/(admin)/admin/orders/order-list-table";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

// R-052/R-105: searchable, filterable, paginated order list. The URL is the
// source of truth — a filtered page is shareable and survives pagination.
// Queries stay bounded (take/skip) at any table size (G-024).
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("payments.manage");
  const openSeason = await getOpenSeason();
  const params = parseOrderListParams(await searchParams);

  if (!openSeason) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Orders</h1>
        <p className="mt-4 text-sm text-stone-600">No open season — orders appear once a season opens.</p>
      </div>
    );
  }

  const where = buildOrderWhere(openSeason.id, params);
  const total = await prisma.order.count({ where });
  const page = clampPage(params.page, total, params.pageSize);
  const orders = await prisma.order.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: params.pageSize,
    skip: (page - 1) * params.pageSize,
    select: {
      id: true,
      orderNumber: true,
      wireFormat: true,
      draftRef: true,
      status: true,
      paymentStatus: true,
      totalCents: true,
      createdAt: true,
      customer: { select: { name: true, email: true } },
    },
  });

  const rows: OrderListRow[] = orders.map((order) => ({
    id: order.id,
    label: order.wireFormat ?? order.draftRef ?? order.id,
    customer: `${order.customer.name} · ${order.customer.email}`,
    status: order.status,
    paymentStatus: order.paymentStatus,
    total: formatCents(order.totalCents),
    created: order.createdAt.toISOString().slice(0, 10),
    repeatable: order.status === "FINALIZED",
    discardable: order.status === "DRAFT",
  }));

  const pages = pageCount(total, params.pageSize);
  const pageHref = (target: number) =>
    buildListHref("/admin/orders", { q: params.q, status: params.status, payment: params.payment }, params.pageSize, target);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Orders</h1>

      <form method="GET" action="/admin/orders" className="mt-4 flex flex-wrap items-end gap-3" data-order-filters>
        <div>
          <label htmlFor="q" className="block text-xs font-medium text-stone-600">
            Search
          </label>
          <Input
            id="q"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Order #, wire ref, customer…"
            className="mt-1 w-64"
          />
        </div>
        <div>
          <label htmlFor="status" className="block text-xs font-medium text-stone-600">
            Status
          </label>
          <Select id="status" name="status" defaultValue={params.status ?? ""} className="mt-1">
            <option value="">All</option>
            {Object.values(OrderStatus).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="payment" className="block text-xs font-medium text-stone-600">
            Payment
          </label>
          <Select id="payment" name="payment" defaultValue={params.payment ?? ""} className="mt-1">
            <option value="">All</option>
            {Object.values(PaymentStatus).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="size" className="block text-xs font-medium text-stone-600">
            Page size
          </label>
          <Select id="size" name="size" defaultValue={String(params.pageSize)} className="mt-1">
            {LIST_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        </div>
        <button
          type="submit"
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          Apply
        </button>
      </form>

      <p className="mt-4 text-sm text-stone-500" data-order-count>
        {total} order{total === 1 ? "" : "s"} — page {page} of {pages}
      </p>

      <OrderListTable rows={rows} />

      <PaginationNav page={page} pages={pages} href={pageHref} dataAttr="data-order-pagination" />
    </div>
  );
}
