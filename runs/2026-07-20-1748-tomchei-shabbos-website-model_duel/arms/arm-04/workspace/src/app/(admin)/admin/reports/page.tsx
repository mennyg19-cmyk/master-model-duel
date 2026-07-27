import Link from 'next/link';

import { ReportTabs } from './reports-tabs';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { requirePermission } from '@/lib/auth/staff';
import { formatCents } from '@/lib/core/money';
import { readSeasonPerformance } from '@/lib/reports/season-performance';

export const dynamic = 'force-dynamic';

/**
 * Every campaign the organisation has run, side by side (R-091).
 *
 * The question this page exists for is "is this year better than last year",
 * and the only honest way to answer it is to put the years in one table with
 * one definition of what counts. Each row links to the season's own breakdown.
 */
export default async function ReportsPage() {
  await requirePermission('reports.view');
  const seasons = await readSeasonPerformance();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Placed, in fulfillment and completed orders count. Drafts and cancelled orders never do.
        </p>
      </header>

      <ReportTabs active="/admin/reports" />

      {seasons.length === 0 ? (
        <Card>
          <CardTitle>No seasons yet</CardTitle>
          <CardDescription>Create a season and the year will start reporting itself.</CardDescription>
        </Card>
      ) : (
        <table className="w-full text-sm" data-testid="season-performance">
          <thead className="text-left text-[var(--color-ink-muted)]">
            <tr>
              <th className="py-2">Season</th>
              <th className="text-right">Orders</th>
              <th className="text-right">Households</th>
              <th className="text-right">Packages</th>
              <th className="text-right">Revenue</th>
              <th className="text-right">Paid</th>
              <th className="text-right">Outstanding</th>
              <th className="text-right">Refunded</th>
            </tr>
          </thead>
          <tbody>
            {seasons.map((season) => (
              <tr
                key={season.seasonId}
                className="border-t border-[var(--color-line)]"
                data-testid={`season-row-${season.year}`}
              >
                <td className="py-2">
                  <Link
                    href={`/admin/reports/${season.seasonId}`}
                    className="underline underline-offset-4"
                  >
                    {season.label}
                  </Link>{' '}
                  <Badge tone={season.status === 'OPEN' ? 'success' : 'neutral'}>{season.status}</Badge>
                </td>
                <td className="text-right">{season.orderCount}</td>
                <td className="text-right">{season.customerCount}</td>
                <td className="text-right">{season.packageCount}</td>
                <td className="text-right">{formatCents(season.revenueCents)}</td>
                <td className="text-right">{formatCents(season.paidCents)}</td>
                <td className="text-right">{formatCents(season.outstandingCents)}</td>
                <td className="text-right">{formatCents(season.refundedCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
