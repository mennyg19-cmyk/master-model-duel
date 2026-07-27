import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ReportTabs } from '../reports-tabs';
import { Figure } from '@/components/ui/figure';
import { requirePermission } from '@/lib/auth/staff';
import { formatCents } from '@/lib/core/money';
import { readSeasonDrilldown } from '@/lib/reports/season-performance';

export const dynamic = 'force-dynamic';

/**
 * One season, broken four ways (R-091).
 *
 * What sold, how it travelled, how it was paid for and where the orders ended
 * up — the four questions that follow "how did the year go", each answered by a
 * grouped query rather than by loading the season.
 */
export default async function SeasonReportPage({
  params,
}: {
  params: Promise<{ seasonId: string }>;
}) {
  const [{ seasonId }] = await Promise.all([params, requirePermission('reports.view')]);

  const report = await readSeasonDrilldown(seasonId);
  if (!report) notFound();

  const { totals } = report;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{totals.label}</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          {totals.orderCount} orders from {totals.customerCount} households, in {totals.packageCount}{' '}
          boxes.{' '}
          <Link href={`/admin/reports/margin?seasonId=${seasonId}`} className="underline underline-offset-4">
            Shipping margin
          </Link>
        </p>
      </header>

      <ReportTabs active="/admin/reports" />

      <dl className="grid gap-3 sm:grid-cols-4">
        <Figure label="Boxes and add-ons" value={formatCents(totals.subtotalCents)} />
        <Figure label="Fulfillment fees" value={formatCents(totals.feeCents)} />
        <Figure label="Paid" value={formatCents(totals.paidCents)} />
        <Figure label="Outstanding" value={formatCents(totals.outstandingCents)} />
      </dl>

      <Breakdown
        title="What sold"
        testId="drilldown-products"
        columns={['Item', 'Units', 'Lines', 'Gross']}
        rows={report.byProduct.map((row) => [
          row.productName,
          String(row.units),
          String(row.lineCount),
          formatCents(row.grossCents),
        ])}
      />

      <Breakdown
        title="How it travelled"
        testId="drilldown-methods"
        columns={['Method', 'Kind', 'Boxes', 'Fees']}
        rows={report.byMethod.map((row) => [
          row.methodLabel,
          row.kind,
          String(row.packageCount),
          formatCents(row.feeCents),
        ])}
      />

      <Breakdown
        title="How it was paid for"
        testId="drilldown-payments"
        columns={['Method', 'Payments', 'Amount']}
        rows={report.byPaymentMethod.map((row) => [
          row.method,
          String(row.paymentCount),
          formatCents(row.amountCents),
        ])}
      />

      <Breakdown
        title="Where the orders are"
        testId="drilldown-statuses"
        columns={['Status', 'Orders', 'Value']}
        rows={report.byStatus.map((row) => [
          row.status,
          String(row.orderCount),
          formatCents(row.totalCents),
        ])}
      />
    </div>
  );
}

function Breakdown({
  title,
  testId,
  columns,
  rows,
}: {
  title: string;
  testId: string;
  columns: string[];
  rows: string[][];
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-muted)]" data-testid={testId}>
          Nothing to show for this season.
        </p>
      ) : (
        <table className="w-full text-sm" data-testid={testId}>
          <thead className="text-left text-[var(--color-ink-muted)]">
            <tr>
              {columns.map((column, index) => (
                <th key={column} className={index === 0 ? 'py-2' : 'text-right'}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]} className="border-t border-[var(--color-line)]">
                {row.map((cell, index) => (
                  <td key={columns[index]} className={index === 0 ? 'py-2' : 'text-right'}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}