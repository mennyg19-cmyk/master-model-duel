import { Card } from '@/components/ui/card';
import { requirePermission } from '@/lib/auth/staff';
import { db } from '@/lib/db';
import { formatDateTime } from '@/lib/core/dates';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

export default async function AuditPage() {
  await requirePermission('audit.view');

  const events = await db.auditEvent.findMany({
    orderBy: { createdAt: 'desc' },
    take: PAGE_SIZE,
    include: { impersonated: { select: { fullName: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Newest {PAGE_SIZE} security events. Actions taken while impersonating show both names.
        </p>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm" data-testid="audit-table">
          <thead className="border-b border-[var(--color-line)] bg-[var(--color-surface-muted)] text-left">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Action</th>
              <th className="px-4 py-2 font-medium">Actor</th>
              <th className="px-4 py-2 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-b border-[var(--color-line)] last:border-0">
                <td className="whitespace-nowrap px-4 py-2 text-[var(--color-ink-muted)]">
                  {formatDateTime(event.createdAt)}
                </td>
                <td className="px-4 py-2 font-medium">{event.action}</td>
                <td className="px-4 py-2">
                  {event.actorLabel}
                  {event.impersonated ? ` (as ${event.impersonated.fullName})` : ''}
                </td>
                <td className="px-4 py-2 text-[var(--color-ink-muted)]">
                  {JSON.stringify(event.detail)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
