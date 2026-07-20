import type { CachedPaymentStatus, OrderStatus } from "@prisma/client";
import Link from "next/link";
import { BulkRepeatButton } from "@/components/admin-order-actions";
import { listOrders } from "@/lib/admin-operations";
import { requirePermission } from "@/lib/auth";
import { formatCurrency } from "@/lib/currency";
import { hasPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string; payment?: string }>;
}) {
  const session = await requirePermission("admin:view");
  const query = await searchParams;
  const listing = await listOrders({
    page: Number(query.page) || 1,
    query: query.q,
    status: query.status as OrderStatus | undefined,
    payment: query.payment as CachedPaymentStatus | undefined,
  });
  const preserved = new URLSearchParams();
  if (query.q) preserved.set("q", query.q);
  if (query.status) preserved.set("status", query.status);
  if (query.payment) preserved.set("payment", query.payment);

  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">Operations</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black">Orders</h1>
          <p className="mt-2 text-[var(--muted)]">{listing.total.toLocaleString()} matching orders</p>
        </div>
        {hasPermission(session.effective, "orders:manage") && (
          <BulkRepeatButton orders={listing.orders.map((order) => ({ id: order.id, version: order.version, status: order.status }))} />
        )}
      </div>
      <form className="mt-7 grid gap-3 rounded-2xl border border-[var(--border)] bg-white p-4 md:grid-cols-[1fr_180px_180px_auto]">
        <input className="rounded-xl border border-[var(--border)] px-4 py-3" defaultValue={query.q} name="q" placeholder="Order #, reference, customer, email" />
        <select className="rounded-xl border border-[var(--border)] px-3" defaultValue={query.status ?? ""} name="status">
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="FINALIZED">Finalized</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <select className="rounded-xl border border-[var(--border)] px-3" defaultValue={query.payment ?? ""} name="payment">
          <option value="">All payments</option>
          <option value="UNPAID">Unpaid</option>
          <option value="PARTIALLY_PAID">Partially paid</option>
          <option value="PAID">Paid</option>
          <option value="REFUNDED">Refunded</option>
        </select>
        <button className="rounded-xl bg-[var(--ink)] px-5 py-3 font-bold text-white">Search</button>
      </form>
      <div className="mt-5 overflow-x-auto rounded-2xl border border-[var(--border)] bg-white">
        <table className="w-full min-w-[800px] text-left">
          <thead className="bg-[var(--surface)] text-sm"><tr><th className="p-4">Order</th><th>Customer</th><th>Status</th><th>Payment</th><th>Gifts</th><th className="pr-4 text-right">Total</th></tr></thead>
          <tbody className="divide-y divide-[var(--border)]">
            {listing.orders.map((order) => (
              <tr key={order.id}>
                <td className="p-4"><Link className="font-bold text-[var(--brand)]" href={`/admin/orders/${order.id}`}>#{order.orderNumber ?? order.draftReference}</Link><p className="text-xs text-[var(--muted)]">{order.createdAt.toLocaleString()}</p></td>
                <td>{order.customer.displayName}<p className="text-xs text-[var(--muted)]">{order.customer.email}</p></td>
                <td>{order.status}</td><td>{order.cachedPaymentStatus}</td><td>{order._count.lines}</td>
                <td className="pr-4 text-right font-bold">{formatCurrency(order.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav className="mt-5 flex items-center justify-between">
        {listing.page > 1 ? <Link href={`?${new URLSearchParams([...preserved, ["page", String(listing.page - 1)]])}`}>← Previous</Link> : <span />}
        <span className="text-sm text-[var(--muted)]">Page {listing.page} of {listing.pages}</span>
        {listing.page < listing.pages ? <Link href={`?${new URLSearchParams([...preserved, ["page", String(listing.page + 1)]])}`}>Next →</Link> : <span />}
      </nav>
    </div>
  );
}
