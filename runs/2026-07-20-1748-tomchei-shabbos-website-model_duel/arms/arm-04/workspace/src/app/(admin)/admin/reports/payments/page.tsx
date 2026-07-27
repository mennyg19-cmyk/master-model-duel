import Link from 'next/link';

import { reconcilePaymentsAction } from './actions';
import { ReportTabs } from '../reports-tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { FlashMessages } from '@/components/ui/flash';
import { requirePermission } from '@/lib/auth/staff';
import { formatDateTime } from '@/lib/core/dates';
import { formatCents } from '@/lib/core/money';
import { readReconciliationFlags, readReconciliationRuns } from '@/lib/payments/reconciliation';

export const dynamic = 'force-dynamic';

const FLAG_LABELS: Record<string, string> = {
  ORPHANED_INTENT: 'Paid, nothing recorded',
  AMOUNT_MISMATCH: 'Amounts disagree',
  MISSING_INTENT: 'No checkout on file',
};

/**
 * Where the ledger and the gateway disagree (R-093).
 *
 * Nothing on this page fixes anything. Every row is a question for a person,
 * because the fix for "the money arrived and the order says unpaid" depends
 * entirely on which of the two is right, and a screen guessing at that would be
 * a screen that occasionally marks an unpaid order paid.
 */
export default async function PaymentReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; problem?: string }>;
}) {
  const [params] = await Promise.all([searchParams, requirePermission('reports.view')]);
  const [flags, runs] = await Promise.all([readReconciliationFlags(), readReconciliationRuns()]);

  const openCount = flags.filter((flag) => flag.status === 'OPEN').length;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Payment reconciliation</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Runs nightly on its own. This is the same sweep, on demand.
        </p>
      </header>

      <ReportTabs active="/admin/reports/payments" />
      <FlashMessages notice={params.notice} problem={params.problem} testIdPrefix="reconciliation" />

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>{openCount === 0 ? 'Everything agrees' : `${openCount} to look at`}</CardTitle>
          <CardDescription>
            {runs[0]
              ? `Last run ${formatDateTime(runs[0].startedAt)} · ${runs[0].source} · checked ${runs[0].checkedCount}`
              : 'This has never been run.'}
          </CardDescription>
        </div>

        <form action={reconcilePaymentsAction}>
          <Button type="submit" data-testid="reconcile-run">
            Run it now
          </Button>
        </form>
      </Card>

      {flags.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-muted)]">
          No discrepancies have ever been found.
        </p>
      ) : (
        <table className="w-full text-sm" data-testid="reconciliation-flags">
          <thead className="text-left text-[var(--color-ink-muted)]">
            <tr>
              <th className="py-2">Problem</th>
              <th>Order</th>
              <th>What it says</th>
              <th className="text-right">Gateway</th>
              <th className="text-right">Recorded</th>
              <th>First seen</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {flags.map((flag) => (
              <tr key={flag.id} className="border-t border-[var(--color-line)]">
                <td className="py-2">{FLAG_LABELS[flag.kind] ?? flag.kind}</td>
                <td>
                  {flag.orderId ? (
                    <Link href={`/admin/orders/${flag.orderId}`} className="underline underline-offset-4">
                      {flag.order?.orderNumber ?? 'Order'}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="text-[var(--color-ink-muted)]">{flag.note}</td>
                <td className="text-right">{formatCents(flag.amountCents)}</td>
                <td className="text-right">{formatCents(flag.expectedCents)}</td>
                <td className="text-[var(--color-ink-muted)]">{formatDateTime(flag.firstSeenAt)}</td>
                <td>
                  <Badge tone={flag.status === 'OPEN' ? 'danger' : 'success'}>{flag.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
