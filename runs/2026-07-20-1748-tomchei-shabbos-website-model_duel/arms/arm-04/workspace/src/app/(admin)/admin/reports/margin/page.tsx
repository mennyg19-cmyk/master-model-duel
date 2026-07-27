import { ReportTabs } from '../reports-tabs';
import { SeasonPicker } from '../season-picker';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Figure } from '@/components/ui/figure';
import { requirePermission } from '@/lib/auth/staff';
import { formatDate } from '@/lib/core/dates';
import { formatCents } from '@/lib/core/money';
import { readMarginReport } from '@/lib/reports/margin-report';
import { readSeasonPerformance } from '@/lib/reports/season-performance';

export const dynamic = 'force-dynamic';

/**
 * The shipping spread, box by box (UR-003, G-006).
 *
 * Charged is what the customer paid for postage; paid is what the carrier
 * took. The difference funds the campaign, and this is where somebody can point
 * at the total and follow any part of it back to a recipient.
 */
export default async function MarginReportPage({
  searchParams,
}: {
  searchParams: Promise<{ seasonId?: string }>;
}) {
  const [params] = await Promise.all([searchParams, requirePermission('reports.view')]);

  const seasons = await readSeasonPerformance();
  const season = seasons.find((row) => row.seasonId === params.seasonId) ?? seasons[0];

  if (!season) {
    return (
      <div className="space-y-6">
        <ReportTabs active="/admin/reports/margin" />
        <Card>
          <CardTitle>No seasons yet</CardTitle>
          <CardDescription>There is nothing to reconcile until a season exists.</CardDescription>
        </Card>
      </div>
    );
  }

  const { rows, summary } = await readMarginReport(season.seasonId);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Shipping margin</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Purchased labels only. Failed labels cost nothing and voided ones were refunded.
        </p>
      </header>

      <ReportTabs active="/admin/reports/margin" />

      <SeasonPicker
        action="/admin/reports/margin"
        seasons={seasons.map((row) => ({ id: row.seasonId, label: row.label }))}
        selectedId={season.seasonId}
      />

      <dl className="grid gap-3 sm:grid-cols-4" data-testid="margin-summary">
        <Figure label="Charged to customers" value={formatCents(summary.chargedCents)} />
        <Figure label="Paid to carriers" value={formatCents(summary.paidCents)} />
        <Figure label="Spread kept" value={formatCents(summary.marginCents)} testId="margin-kept" />
        <Figure
          label="Parcels"
          value={`${summary.parcelCount} in ${summary.packageCount} boxes`}
          note={
            summary.unpricedParcelCount > 0
              ? `${summary.unpricedParcelCount} carry no recorded spread.`
              : null
          }
        />
      </dl>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-muted)]">
          No labels have been bought for {season.label}.
        </p>
      ) : (
        <table className="w-full text-sm" data-testid="margin-table">
          <thead className="text-left text-[var(--color-ink-muted)]">
            <tr>
              <th className="py-2">Order</th>
              <th>Recipient</th>
              <th>Carrier</th>
              <th className="text-right">Parcels</th>
              <th className="text-right">Charged</th>
              <th className="text-right">Paid</th>
              <th className="text-right">Spread</th>
              <th>Bought</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.packageId} className="border-t border-[var(--color-line)]">
                <td className="py-2">{row.orderNumber ?? '—'}</td>
                <td>{row.recipientName}</td>
                <td>
                  {row.carrier}
                  {row.serviceLabel ? ` · ${row.serviceLabel}` : ''}
                </td>
                <td className="text-right">{row.parcelCount}</td>
                <td className="text-right">{formatCents(row.customerPriceCents)}</td>
                <td className="text-right">{formatCents(row.carrierCostCents)}</td>
                <td className="text-right">{formatCents(row.marginCents)}</td>
                <td className="text-[var(--color-ink-muted)]">
                  {row.purchasedAt ? formatDate(row.purchasedAt) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
