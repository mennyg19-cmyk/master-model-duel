import Link from "next/link";
import { db } from "@/lib/db";
import { getStaffContext } from "@/lib/auth/current-user";
import { getOpenSeason } from "@/lib/season";
import { formatCents } from "@/lib/catalog";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const RECENT_LIMIT = 10;
const QUEUE_LIMIT = 8;
// A checkout that has sat in DRAFT this long is abandoned or stuck (Today queue).
const STALE_DRAFT_MS = 60 * 60 * 1000;

/** Permission-aware operations dashboard (R-049) + Today work queue (R-050). */
export default async function AdminDashboardPage() {
  const staff = await getStaffContext();
  const canSeeOrders = staff?.actingAs.permissions.has("orders.view") ?? false;
  const canSeeAudit = staff?.actingAs.permissions.has("audit.view") ?? false;
  const season = await getOpenSeason();

  const [staffCount, customerCount, auditCount] = await Promise.all([
    db.staffUser.count(),
    db.customer.count(),
    canSeeAudit ? db.auditLog.count() : Promise.resolve(0),
  ]);

  let orderBlock: React.ReactNode = null;
  if (canSeeOrders && season) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const staleBefore = new Date();
    staleBefore.setTime(staleBefore.getTime() - STALE_DRAFT_MS);
    const [
      finalizedCount,
      revenue,
      collected,
      unpaidCount,
      packagesByStage,
      recentOrders,
      unpaidQueue,
      staleDrafts,
      paymentsToday,
    ] = await Promise.all([
      db.order.count({ where: { seasonId: season.id, status: "FINALIZED" } }),
      db.order.aggregate({
        where: { seasonId: season.id, status: "FINALIZED" },
        _sum: { totalCents: true },
      }),
      db.payment.aggregate({
        where: { state: "POSTED", order: { seasonId: season.id } },
        _sum: { amountCents: true },
      }),
      db.order.count({
        where: { seasonId: season.id, status: "FINALIZED", paymentStatus: { in: ["UNPAID", "PARTIAL"] } },
      }),
      db.package.groupBy({ by: ["stage"], where: { seasonId: season.id }, _count: true }),
      db.order.findMany({
        where: { seasonId: season.id },
        include: { customer: { select: { name: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: RECENT_LIMIT,
      }),
      db.order.findMany({
        where: { seasonId: season.id, status: "FINALIZED", paymentStatus: { in: ["UNPAID", "PARTIAL"] } },
        include: { customer: { select: { name: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: QUEUE_LIMIT,
      }),
      db.order.findMany({
        where: {
          seasonId: season.id,
          status: "DRAFT",
          createdAt: { lt: staleBefore },
        },
        include: { customer: { select: { name: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: QUEUE_LIMIT,
      }),
      db.payment.count({ where: { state: "POSTED", receivedAt: { gte: startOfToday }, order: { seasonId: season.id } } }),
    ]);

    orderBlock = (
      <>
        <div className="grid gap-4 sm:grid-cols-4 mb-6">
          <Card>
            <CardTitle className="text-sm text-muted mb-1">Finalized orders</CardTitle>
            <p className="text-3xl font-bold">{finalizedCount}</p>
          </Card>
          <Card>
            <CardTitle className="text-sm text-muted mb-1">Order revenue</CardTitle>
            <p className="text-3xl font-bold">{formatCents(revenue._sum.totalCents ?? 0)}</p>
          </Card>
          <Card>
            <CardTitle className="text-sm text-muted mb-1">Collected</CardTitle>
            <p className="text-3xl font-bold">{formatCents(collected._sum.amountCents ?? 0)}</p>
          </Card>
          <Card>
            <CardTitle className="text-sm text-muted mb-1">Awaiting payment</CardTitle>
            <p className="text-3xl font-bold">{unpaidCount}</p>
            <p className="text-xs text-muted mt-1">
              Packages:{" "}
              {packagesByStage.length
                ? packagesByStage.map((row) => `${row._count} ${row.stage.toLowerCase().replace("_", " ")}`).join(", ")
                : "none yet"}
            </p>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 mb-6">
          <Card>
            <CardTitle className="mb-3">
              Today{" "}
              <span className="text-xs font-normal text-muted">
                {paymentsToday} payment{paymentsToday === 1 ? "" : "s"} posted today
              </span>
            </CardTitle>
            <QueueSection
              title="Finalized, not fully paid"
              emptyText="Nothing waiting on payment."
              linkAll="/admin/orders?status=FINALIZED&payment=UNPAID"
              rows={unpaidQueue.map((order) => ({
                id: order.id,
                label: `#${order.orderNumber ?? "—"} ${order.customer.name}`,
                detail: `${formatCents(order.totalCents)} · ${order.paymentStatus}`,
              }))}
            />
            <QueueSection
              title="Stale checkout drafts (>1h)"
              emptyText="No stuck checkouts."
              linkAll="/admin/orders?status=DRAFT"
              rows={staleDrafts.map((order) => ({
                id: order.id,
                label: `${order.draftReference} ${order.customer.name}`,
                detail: formatCents(order.totalCents),
              }))}
            />
          </Card>
          <Card>
            <CardTitle className="mb-3">
              Recent orders{" "}
              <Link href="/admin/orders" className="text-xs font-normal text-brand hover:underline">
                All orders →
              </Link>
            </CardTitle>
            <table className="w-full text-sm">
              <tbody>
                {recentOrders.map((order) => (
                  <tr key={order.id} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-2">
                      <Link href={`/admin/orders/${order.id}`} className="text-brand hover:underline">
                        {order.orderNumber ? `#${order.orderNumber}` : order.draftReference}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-2">{order.customer.name}</td>
                    <td className="py-1.5 pr-2">{formatCents(order.totalCents)}</td>
                    <td className="py-1.5">
                      <Badge tone={order.status === "FINALIZED" ? "brand" : "neutral"}>{order.status}</Badge>
                    </td>
                  </tr>
                ))}
                {recentOrders.length === 0 && (
                  <tr>
                    <td className="py-2 text-muted">No orders yet this season.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>
      </>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Dashboard</h1>
      <p className="text-sm text-muted mb-6">
        Signed in as {staff?.actingAs.name} ({staff?.actingAs.role}).
        {season ? ` Season: ${season.name}.` : " No season is open."}
      </p>
      {orderBlock}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardTitle className="text-sm text-muted mb-1">Staff accounts</CardTitle>
          <p className="text-3xl font-bold">{staffCount}</p>
        </Card>
        <Card>
          <CardTitle className="text-sm text-muted mb-1">Customers</CardTitle>
          <p className="text-3xl font-bold">{customerCount}</p>
        </Card>
        {canSeeAudit && (
          <Card>
            <CardTitle className="text-sm text-muted mb-1">Audit entries</CardTitle>
            <p className="text-3xl font-bold">{auditCount}</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function QueueSection({
  title,
  emptyText,
  linkAll,
  rows,
}: {
  title: string;
  emptyText: string;
  linkAll: string;
  rows: { id: string; label: string; detail: string }[];
}) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">
        {title}{" "}
        <Link href={linkAll} className="normal-case font-normal text-brand hover:underline">
          view all
        </Link>
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{emptyText}</p>
      ) : (
        <ul className="text-sm space-y-1">
          {rows.map((row) => (
            <li key={row.id} className="flex justify-between gap-2">
              <Link href={`/admin/orders/${row.id}`} className="truncate text-brand hover:underline">
                {row.label}
              </Link>
              <span className="shrink-0 text-muted">{row.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
