import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { requirePermission } from '@/lib/auth/staff';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { formatDateTime } from '@/lib/core/dates';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  const context = await requirePermission('dashboard.view');

  const [activeStaff, customerCount, recentAudit] = await Promise.all([
    db.staffUser.count({ where: { status: 'ACTIVE' } }),
    db.customer.count(),
    db.auditEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Signed in as {context.acting.fullName} ({context.acting.role.toLowerCase()}).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardTitle>{activeStaff}</CardTitle>
          <CardDescription>Active staff accounts</CardDescription>
        </Card>
        <Card>
          <CardTitle>{customerCount}</CardTitle>
          <CardDescription>Customer records</CardDescription>
        </Card>
        <Card>
          <CardTitle>{context.permissions.length}</CardTitle>
          <CardDescription>
            of {Object.keys(PERMISSIONS).length} permissions granted to you
          </CardDescription>
        </Card>
      </div>

      <Card>
        <CardTitle>Latest security events</CardTitle>
        <ul className="mt-3 space-y-2 text-sm">
          {recentAudit.length === 0 ? (
            <li className="text-[var(--color-ink-muted)]">Nothing recorded yet.</li>
          ) : (
            recentAudit.map((event) => (
              <li key={event.id} className="flex justify-between gap-4">
                <span>{event.action}</span>
                <span className="text-[var(--color-ink-muted)]">
                  {formatDateTime(event.createdAt)}
                </span>
              </li>
            ))
          )}
        </ul>
      </Card>
    </div>
  );
}
