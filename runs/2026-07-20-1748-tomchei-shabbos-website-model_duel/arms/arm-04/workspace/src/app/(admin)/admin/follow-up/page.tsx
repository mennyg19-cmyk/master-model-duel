import Link from 'next/link';

import { NoSeason } from '@/components/admin/no-season';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/field';
import { readActiveSeason } from '@/lib/admin/dashboard';
import { requirePermission } from '@/lib/auth/staff';
import { formatCents } from '@/lib/core/money';
import {
  FOLLOW_UP_REASONS,
  readFollowUpFilters,
  readFollowUpQueue,
  REASON_LABELS,
} from '@/lib/scheduling/follow-up';

export const dynamic = 'force-dynamic';

/**
 * The call centre list (R-079). One volunteer, one headset, one reason at a
 * time — which is why the filter is the first thing on the page.
 */
export default async function FollowUpPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; q?: string }>;
}) {
  const [params] = await Promise.all([searchParams, requirePermission('orders.manage')]);
  const season = await readActiveSeason();

  if (!season) {
    return (
      <NoSeason
        title="Follow-up"
        message="There is no season, so there is nobody to ring."
        testId="follow-up-no-season"
      />
    );
  }

  const filters = readFollowUpFilters(params);
  const rows = await readFollowUpQueue(season.id, filters);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Follow-up</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          {season.label} · {rows.length} call(s) on this list
        </p>
      </header>

      <form className="flex flex-wrap items-end gap-3" data-testid="follow-up-filters">
        <div>
          <Label htmlFor="reason">Why we are ringing</Label>
          <Select id="reason" name="reason" defaultValue={filters.reason ?? ''}>
            <option value="">Every reason</option>
            {FOLLOW_UP_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {REASON_LABELS[reason]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="q">Customer</Label>
          <Input id="q" name="q" defaultValue={filters.search} placeholder="Name" />
        </div>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-muted)]" data-testid="follow-up-empty">
          Nothing to chase.
        </p>
      ) : (
        <table className="w-full text-sm" data-testid="follow-up-table">
          <thead className="text-left text-[var(--color-ink-muted)]">
            <tr>
              <th className="py-2">Customer</th>
              <th>Reason</th>
              <th>Detail</th>
              <th className="text-right">Owed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.orderId}-${row.reason}`}
                className="border-t border-[var(--color-line)]"
                data-testid="follow-up-row"
                data-order-id={row.orderId}
                data-reason={row.reason}
              >
                <td className="py-2">
                  <Link
                    href={`/admin/orders/${row.orderId}`}
                    className="text-[var(--color-brand)] underline underline-offset-4"
                  >
                    {row.customerName}
                  </Link>
                  <span className="block text-[var(--color-ink-muted)]">
                    {row.orderLabel} · {row.phone ?? 'no phone on file'}
                  </span>
                </td>
                <td>
                  <Badge tone={row.reason === 'unpaid' ? 'warning' : 'neutral'}>
                    {REASON_LABELS[row.reason]}
                  </Badge>
                </td>
                <td className="text-[var(--color-ink-muted)]">{row.detail}</td>
                <td className="text-right">
                  {row.owedCents > 0 ? formatCents(row.owedCents) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
