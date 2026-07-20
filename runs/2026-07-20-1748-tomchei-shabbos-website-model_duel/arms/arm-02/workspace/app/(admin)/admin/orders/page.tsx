import Link from "next/link";
import { requirePermissionPage } from "@/lib/auth/current-user";
import { listOrders, parseOrderListFilters, ORDERS_PAGE_SIZE } from "@/lib/orders/list";
import { formatCents } from "@/lib/catalog";
import { Card } from "@/components/ui/card";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/order-badges";
import { OrderBulkActions, BulkCheckbox } from "@/components/admin/order-bulk-actions";

/** Searchable, filterable, paginated order list built for 1k+ orders (R-052, R-105). */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; payment?: string; page?: string }>;
}) {
  const staff = await requirePermissionPage("orders.view");
  const filters = parseOrderListFilters(await searchParams);
  const { total, orders, pageCount } = await listOrders(filters);
  const canBulkManage = staff.actingAs.permissions.has("orders.manage");

  const queryFor = (page: number) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.status) params.set("status", filters.status);
    if (filters.payment) params.set("payment", filters.payment);
    if (page > 1) params.set("page", `${page}`);
    const qs = params.toString();
    return qs ? `/admin/orders?${qs}` : "/admin/orders";
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Orders</h1>
        <p className="text-sm text-muted">
          {total} order{total === 1 ? "" : "s"} · page {filters.page} of {pageCount}
        </p>
      </div>

      <form method="GET" action="/admin/orders" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-muted">
          Search
          <input
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Order #, reference, customer name or email"
            className="mt-1 w-72 rounded-md border border-border bg-white px-3 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="flex flex-col text-xs text-muted">
          Status
          <select
            name="status"
            defaultValue={filters.status ?? ""}
            className="mt-1 rounded-md border border-border bg-white px-2 py-1.5 text-sm text-ink"
          >
            <option value="">All</option>
            <option value="DRAFT">Draft</option>
            <option value="FINALIZED">Finalized</option>
            <option value="DISCARDED">Discarded</option>
          </select>
        </label>
        <label className="flex flex-col text-xs text-muted">
          Payment
          <select
            name="payment"
            defaultValue={filters.payment ?? ""}
            className="mt-1 rounded-md border border-border bg-white px-2 py-1.5 text-sm text-ink"
          >
            <option value="">All</option>
            <option value="UNPAID">Unpaid</option>
            <option value="PARTIAL">Partial</option>
            <option value="PAID">Paid</option>
            <option value="COMPED">Comped</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-strong"
        >
          Filter
        </button>
        {(filters.q || filters.status || filters.payment) && (
          <Link href="/admin/orders" className="px-2 py-1.5 text-sm text-brand hover:underline">
            Clear
          </Link>
        )}
      </form>

      <Card>
        <OrderBulkActions
          enabled={canBulkManage}
          orders={orders.map((order) => ({
            id: order.id,
            status: order.status,
            label: order.orderNumber ? `#${order.orderNumber}` : order.draftReference,
          }))}
        >
          {orders.map((order) => (
            <tr key={order.id} className="border-b border-border last:border-0">
              <td className="py-2 pr-2">{canBulkManage && <BulkCheckbox id={order.id} />}</td>
              <td className="py-2 pr-3">
                <Link href={`/admin/orders/${order.id}`} className="font-medium text-brand hover:underline">
                  {order.orderNumber ? `#${order.orderNumber}` : order.draftReference}
                </Link>
              </td>
              <td className="py-2 pr-3">
                <span className="block">{order.customer.name}</span>
                <span className="text-xs text-muted">{order.customer.email}</span>
              </td>
              <td className="py-2 pr-3 whitespace-nowrap">{order.createdAt.toISOString().slice(0, 10)}</td>
              <td className="py-2 pr-3">{order._count.lines}</td>
              <td className="py-2 pr-3">{formatCents(order.totalCents)}</td>
              <td className="py-2 pr-3">
                <OrderStatusBadge status={order.status} />
              </td>
              <td className="py-2">
                <PaymentStatusBadge status={order.paymentStatus} />
              </td>
            </tr>
          ))}
          {orders.length === 0 && (
            <tr>
              <td colSpan={8} className="py-4 text-muted">
                No orders match these filters.
              </td>
            </tr>
          )}
        </OrderBulkActions>
      </Card>

      {pageCount > 1 && (
        <div className="mt-4 flex items-center gap-3 text-sm">
          {filters.page > 1 && (
            <Link href={queryFor(filters.page - 1)} className="text-brand hover:underline">
              ← Previous
            </Link>
          )}
          <span className="text-muted">
            Showing {(filters.page - 1) * ORDERS_PAGE_SIZE + (orders.length ? 1 : 0)}–
            {(filters.page - 1) * ORDERS_PAGE_SIZE + orders.length} of {total}
          </span>
          {filters.page < pageCount && (
            <Link href={queryFor(filters.page + 1)} className="text-brand hover:underline">
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
