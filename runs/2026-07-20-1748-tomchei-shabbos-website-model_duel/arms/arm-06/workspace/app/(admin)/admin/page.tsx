import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getOpenSeason } from "@/lib/seasons/queries";
import { getDashboardData, QueueOrder } from "@/lib/admin/dashboard";
import { formatCents } from "@/lib/money";
import { Card, CardTitle } from "@/components/ui/card";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/order-badges";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

// R-049/R-050: permission-aware KPIs + the Today work queue. Cards and queues
// render only when the staff user holds the permission that acts on them —
// a POS-floor login sees orders and money, never catalog internals.
export default async function AdminDashboardPage() {
  const ctx = await requireStaff();
  const openSeason = await getOpenSeason();
  const canPayments = hasPermission(ctx.staff, "payments.manage");
  const canCustomers = hasPermission(ctx.staff, "customers.manage");

  const data = canPayments ? await getDashboardData(openSeason?.id ?? null) : null;

  const kpis = data
    ? [
        { label: "Orders today", value: String(data.kpis.ordersToday) },
        { label: "Collected today", value: formatCents(data.kpis.revenueTodayCents) },
        { label: "Awaiting collection", value: String(data.kpis.awaitingCollection) },
        { label: "In-flight checkouts", value: String(data.kpis.inFlightCheckouts) },
      ]
    : [];

  return (
    <div>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-1 text-sm text-stone-500">
        {openSeason ? `Season ${openSeason.name} is open.` : "No open season — the store is closed."}
      </p>

      {kpis.length > 0 && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-kpis>
          {kpis.map((kpi) => (
            <Card key={kpi.label} className="p-5">
              <CardTitle className="text-sm font-medium text-stone-500">{kpi.label}</CardTitle>
              <p className="mt-2 text-3xl font-bold" data-kpi={kpi.label}>
                {kpi.value}
              </p>
            </Card>
          ))}
        </div>
      )}

      {data && (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <QueueSection
            title="Collect payment"
            empty="Nothing waiting on payment."
            orders={data.collectQueue}
            queueName="collect"
          />
          <QueueSection
            title="In-flight checkouts"
            empty="No submitted orders waiting on payment."
            orders={data.inFlightQueue}
            queueName="in-flight"
          />
        </div>
      )}

      {data && (
        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent orders</h2>
            <Link href="/admin/orders" className="text-sm font-medium text-brand-700 hover:underline">
              All orders →
            </Link>
          </div>
          <OrderTable orders={data.recentOrders} empty="No orders yet this season." />
        </section>
      )}

      {canCustomers && (
        <p className="mt-8 text-sm">
          <Link href="/admin/customers" className="font-medium text-brand-700 hover:underline">
            Customer directory →
          </Link>
        </p>
      )}
    </div>
  );
}

function QueueSection({
  title,
  empty,
  orders,
  queueName,
}: {
  title: string;
  empty: string;
  orders: QueueOrder[];
  queueName: string;
}) {
  return (
    <section data-queue={queueName}>
      <h2 className="text-lg font-semibold">{title}</h2>
      <OrderTable orders={orders} empty={empty} />
    </section>
  );
}

function OrderTable({ orders, empty }: { orders: QueueOrder[]; empty: string }) {
  if (orders.length === 0) return <p className="mt-2 text-sm text-stone-500">{empty}</p>;
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {orders.map((order) => (
        <li key={order.id}>
          <Link
            href={`/admin/orders/${order.id}`}
            className="flex items-center justify-between rounded-md border border-stone-200 bg-white px-3 py-2 text-sm hover:border-brand-300"
          >
            <span className="font-medium text-stone-900">{order.label}</span>
            <span className="text-stone-600">{order.customerName}</span>
            <span className="flex items-center gap-2">
              <OrderStatusBadge status={order.status} />
              <PaymentStatusBadge status={order.paymentStatus} />
              <span className="font-medium">{formatCents(order.totalCents)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
