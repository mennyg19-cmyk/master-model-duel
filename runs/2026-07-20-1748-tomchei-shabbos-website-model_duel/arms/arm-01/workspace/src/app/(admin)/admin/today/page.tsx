import Link from "next/link";
import { getTodayQueue } from "@/lib/admin-operations";
import { requirePermission } from "@/lib/auth";
import { formatCurrency } from "@/lib/currency";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  await requirePermission("admin:view");
  const orders = await getTodayQueue();
  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">Work queue</p>
      <h1 className="mt-2 text-4xl font-black">Today</h1>
      <p className="mt-3 text-[var(--muted)]">
        New orders and outstanding balances, capped at 100 records.
      </p>
      <div className="mt-8 space-y-3">
        {orders.map((order) => (
          <Link
            className="grid gap-3 rounded-2xl border border-[var(--border)] bg-white p-5 sm:grid-cols-[1fr_auto_auto] sm:items-center"
            href={`/admin/orders/${order.id}`}
            key={order.id}
          >
            <div>
              <p className="font-bold">#{order.orderNumber ?? order.draftReference} · {order.customer.displayName}</p>
              <p className="text-sm text-[var(--muted)]">{order.customer.email ?? order.customer.phone ?? "No contact"} · {order._count.lines} gifts</p>
            </div>
            <span className="rounded-full bg-[var(--surface)] px-3 py-1 text-sm font-bold">{order.cachedPaymentStatus}</span>
            <span className="font-bold">{formatCurrency(order.totalCents)}</span>
          </Link>
        ))}
        {!orders.length && <p className="rounded-2xl bg-white p-8 text-center text-[var(--muted)]">Queue clear.</p>}
      </div>
    </div>
  );
}
