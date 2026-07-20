import Link from "next/link";
import { getOperationsDashboard } from "@/lib/admin-operations";
import { requirePermission } from "@/lib/auth";
import { formatCurrency } from "@/lib/currency";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const session = await requirePermission("admin:view");
  const canViewAudit = hasPermission(session.effective, "audit:view");
  const [dashboard, auditEvents] = await Promise.all([
    getOperationsDashboard(),
    canViewAudit
      ? db.auditLog.findMany({
          orderBy: { occurredAt: "desc" },
          take: 6,
        })
      : Promise.resolve([]),
  ]);

  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
        Operations hub
      </p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight text-[var(--ink)]">
        Good evening
      </h1>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Finalized orders", dashboard.orderCount.toLocaleString()],
          ["Orders today", dashboard.todayCount.toLocaleString()],
          ["Needs payment", dashboard.unpaidCount.toLocaleString()],
          ["Season revenue", formatCurrency(dashboard.grossCents)],
        ].map(([label, value]) => (
          <article className="rounded-3xl border border-[var(--border)] bg-white p-6" key={label}>
            <p className="text-sm font-semibold text-[var(--muted)]">{label}</p>
            <p className="mt-2 text-3xl font-bold">{value}</p>
          </article>
        ))}
      </div>
      <section className="mt-8 rounded-3xl border border-[var(--border)] bg-white p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold">Recent orders</h2>
          <Link className="font-bold text-[var(--brand)]" href="/admin/orders">View all</Link>
        </div>
        <div className="mt-4 divide-y divide-[var(--border)]">
          {dashboard.recentOrders.map((order) => (
            <Link className="flex items-center justify-between gap-4 py-3" href={`/admin/orders/${order.id}`} key={order.id}>
              <span>
                <span className="font-bold">#{order.orderNumber ?? order.draftReference}</span>
                <span className="ml-3 text-sm text-[var(--muted)]">{order.customer.displayName}</span>
              </span>
              <span className="font-semibold">{formatCurrency(order.totalCents)}</span>
            </Link>
          ))}
        </div>
      </section>
      {canViewAudit && (
        <section className="mt-8 rounded-3xl border border-[var(--border)] bg-white p-6">
          <h2 className="text-xl font-bold">Recent security activity</h2>
          <div className="mt-5 divide-y divide-[var(--border)]">
            {auditEvents.map((event) => (
              <div key={event.id} className="flex items-center justify-between gap-4 py-4">
                <div>
                  <p className="font-semibold">{event.action}</p>
                  <p className="text-sm text-[var(--muted)]">
                    {event.targetType} · {event.targetId}
                  </p>
                </div>
                <time className="text-sm text-[var(--muted)]">
                  {event.occurredAt.toLocaleString()}
                </time>
              </div>
            ))}
            {auditEvents.length === 0 && (
              <p className="py-8 text-center text-[var(--muted)]">No activity yet.</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
