import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermissionPage } from "@/lib/auth/current-user";
import { getOpenSeason } from "@/lib/season";
import { getSetting } from "@/lib/settings";
import { pickupBoard } from "@/lib/pickup";
import { formatCents } from "@/lib/catalog";
import { Card, CardTitle } from "@/components/ui/card";

// Follow-up call center (R-079): one list per reason staff would ring a
// customer — open balances, unclaimed pickups, undelivered route stops —
// with contact details in the row so the call happens from this screen.

const FILTERS = [
  { key: "unpaid", label: "Open balances" },
  { key: "unclaimed", label: "Unclaimed pickups" },
  { key: "undelivered", label: "Undelivered stops" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

export default async function FollowUpPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requirePermissionPage("orders.view");
  const season = await getOpenSeason();
  if (!season) return <p className="text-sm text-muted">No open season.</p>;

  const { filter: rawFilter } = await searchParams;
  const filter: FilterKey = FILTERS.some((entry) => entry.key === rawFilter) ? (rawFilter as FilterKey) : "unpaid";
  const followupDays = await getSetting("orders.followup_days");

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Follow-up call center</h1>
      <div className="flex gap-1 border-b border-border">
        {FILTERS.map((entry) => (
          <Link
            key={entry.key}
            href={`/admin/follow-up?filter=${entry.key}`}
            className={`rounded-t-md px-4 py-2 text-sm font-medium ${
              filter === entry.key ? "border border-b-0 border-border bg-surface text-brand-strong" : "text-muted hover:text-foreground"
            }`}
          >
            {entry.label}
          </Link>
        ))}
      </div>

      {filter === "unpaid" && <UnpaidList seasonId={season.id} />}
      {filter === "unclaimed" && <UnclaimedList seasonId={season.id} followupDays={followupDays} />}
      {filter === "undelivered" && <UndeliveredList seasonId={season.id} />}
    </div>
  );
}

async function UnpaidList({ seasonId }: { seasonId: string }) {
  const orders = await db.order.findMany({
    where: { seasonId, status: "FINALIZED", paymentStatus: { in: ["UNPAID", "PARTIAL"] } },
    include: {
      customer: { select: { name: true, email: true, phone: true } },
      payments: { where: { state: "POSTED" }, select: { amountCents: true } },
    },
    orderBy: { orderNumber: "asc" },
  });
  const reminders = await db.notification.groupBy({
    by: ["orderId"],
    where: { kind: "payment_reminder", orderId: { in: orders.map((order) => order.id) } },
    _count: true,
  });
  const reminderCount = new Map(reminders.map((entry) => [entry.orderId, entry._count]));

  return (
    <Card>
      <CardTitle>Finalized orders with an open balance ({orders.length})</CardTitle>
      {orders.length === 0 ? (
        <p className="text-sm text-muted">Everyone paid up.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="py-2">Order</th>
              <th>Customer</th>
              <th>Contact</th>
              <th>Owed</th>
              <th>Reminders sent</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const paid = order.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
              return (
                <tr key={order.id} className="border-b border-border/60">
                  <td className="py-2">
                    <Link href={`/admin/orders/${order.id}`} className="underline">#{order.orderNumber}</Link>
                  </td>
                  <td>{order.customer.name}</td>
                  <td className="text-muted">{order.customer.phone ?? order.customer.email}</td>
                  <td>{formatCents(order.totalCents - paid)}</td>
                  <td className="text-muted">{reminderCount.get(order.id) ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

async function UnclaimedList({ seasonId, followupDays }: { seasonId: string; followupDays: number }) {
  const { board } = await pickupBoard(seasonId);
  const rows = board.filter((entry) => entry.unclaimed || entry.pickupExpiredAt);
  return (
    <Card>
      <CardTitle>Pickups waiting more than {followupDays} day(s) ({rows.length})</CardTitle>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No unclaimed pickups.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((entry) => (
            <li key={entry.id}>
              {entry.recipientName} — {entry.pickupExpiredAt ? "EXPIRED" : `ready ${entry.pickupReadyAt?.toISOString().slice(0, 10)}`} ·{" "}
              {entry.customers.map((customer) => `${customer.name} (${customer.phone ?? customer.email})`).join(", ")}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

async function UndeliveredList({ seasonId }: { seasonId: string }) {
  const stops = await db.routeStop.findMany({
    where: { deliveredAt: null, route: { seasonId, status: { not: "PLANNED" } } },
    include: {
      route: { select: { id: true, name: true, status: true } },
      package: { select: { recipientName: true, addressLine1: true, city: true } },
    },
    orderBy: [{ routeId: "asc" }, { position: "asc" }],
  });
  return (
    <Card>
      <CardTitle>Stops still pending on started routes ({stops.length})</CardTitle>
      {stops.length === 0 ? (
        <p className="text-sm text-muted">Every started route is fully delivered.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {stops.map((stop) => (
            <li key={stop.id}>
              <Link href={`/admin/routes/${stop.route.id}`} className="underline">{stop.route.name}</Link>{" "}
              stop {stop.position}: {stop.package.recipientName}, {stop.package.addressLine1}, {stop.package.city}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
