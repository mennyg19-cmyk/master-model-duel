import Link from 'next/link';

import { OrderQueue } from './today/order-queue';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { readActiveSeason, readDashboard, readTodayQueue } from '@/lib/admin/dashboard';
import { requirePermission } from '@/lib/auth/staff';
import { formatCents } from '@/lib/core/money';
import { formatDateTime } from '@/lib/core/dates';
import { db } from '@/lib/db';
import { listOrderDesk, readOrderDeskFilters } from '@/lib/orders/order-desk';
import { readPageRequest } from '@/lib/admin/list-query';

export const dynamic = 'force-dynamic';

/**
 * R-049. What the office sees when it opens the laptop.
 *
 * Everything on this page is permission-filtered rather than role-filtered: a
 * member of staff who cannot see orders gets the shell, not an empty grid of
 * zeros they are left to wonder about. The audit panel is the same rows
 * `/admin/audit` serves and is gated on the same permission, so the dashboard
 * cannot become the back door into a page that 403s.
 */
export default async function AdminDashboardPage() {
  const context = await requirePermission('dashboard.view');
  const canSeeOrders = context.permissions.includes('orders.view');
  const canSeeAudit = context.permissions.includes('audit.view');

  const season = await readActiveSeason();

  if (!season || !canSeeOrders) {
    return (
      <div className="space-y-6">
        <Heading name={context.acting.fullName} role={context.acting.role} season={season?.label ?? null} />
        {canSeeAudit ? <RecentSecurityEvents /> : null}
        {canSeeOrders ? null : (
          <p className="text-sm text-[var(--color-ink-muted)]" data-testid="dashboard-restricted">
            Your account does not include order access, so the sales figures are hidden.
          </p>
        )}
      </div>
    );
  }

  const [kpis, queue, recent] = await Promise.all([
    readDashboard(season.id, season.label),
    readTodayQueue(season.id),
    listOrderDesk(readOrderDeskFilters({}), readPageRequest({ size: '5' })),
  ]);

  return (
    <div className="space-y-6">
      <Heading name={context.acting.fullName} role={context.acting.role} season={season.label} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="dashboard-kpis">
        <Kpi
          testId="kpi-orders"
          amount={kpis.ordersPlaced}
          value={kpis.ordersPlaced.toLocaleString('en-US')}
          label="Orders this season"
        />
        <Kpi
          testId="kpi-today"
          amount={kpis.ordersToday}
          value={kpis.ordersToday.toLocaleString('en-US')}
          label="Placed today"
        />
        <Kpi
          testId="kpi-billed"
          amount={kpis.itemsSoldCents}
          value={formatCents(kpis.itemsSoldCents)}
          label="Billed this season"
        />
        <Kpi
          testId="kpi-outstanding"
          amount={kpis.outstandingCents}
          value={formatCents(kpis.outstandingCents)}
          label={`Outstanding across ${kpis.unpaidOrders} order${kpis.unpaidOrders === 1 ? '' : 's'}`}
        />
      </div>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Today</h2>
          <Link href="/admin/today" className="text-sm underline underline-offset-4">
            The whole queue
          </Link>
        </div>
        <OrderQueue
          testId="dashboard-awaiting"
          title="Waiting on payment"
          empty="Nothing is owing."
          rows={queue.awaitingPayment}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Latest orders</h2>
          <Link href="/admin/orders" className="text-sm underline underline-offset-4">
            All orders
          </Link>
        </div>
        <OrderQueue
          testId="dashboard-recent"
          title="Most recently placed"
          empty="No orders have been placed yet."
          rows={recent.rows}
        />
      </section>

      {canSeeAudit ? <RecentSecurityEvents /> : null}
    </div>
  );
}

function Heading({ name, role, season }: { name: string; role: string; season: string | null }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-1 flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
        <span>Signed in as {name}</span>
        <Badge tone="neutral">{role}</Badge>
        {season ? <span>· {season}</span> : null}
      </p>
    </div>
  );
}

function Kpi({
  value,
  amount,
  label,
  testId,
}: {
  value: string;
  /** The same figure unformatted, so a check reads the number and not the commas. */
  amount: number;
  label: string;
  testId: string;
}) {
  return (
    <Card data-testid={testId} data-value={amount}>
      <CardTitle className="text-2xl">{value}</CardTitle>
      <CardDescription>{label}</CardDescription>
    </Card>
  );
}

async function RecentSecurityEvents() {
  const events = await db.auditEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });

  return (
    <Card>
      <CardTitle>Latest security events</CardTitle>
      <ul className="mt-3 space-y-2 text-sm">
        {events.length === 0 ? (
          <li className="text-[var(--color-ink-muted)]">Nothing recorded yet.</li>
        ) : (
          events.map((event) => (
            <li key={event.id} className="flex justify-between gap-4">
              <span>{event.action}</span>
              <span className="text-[var(--color-ink-muted)]">{formatDateTime(event.createdAt)}</span>
            </li>
          ))
        )}
      </ul>
    </Card>
  );
}
