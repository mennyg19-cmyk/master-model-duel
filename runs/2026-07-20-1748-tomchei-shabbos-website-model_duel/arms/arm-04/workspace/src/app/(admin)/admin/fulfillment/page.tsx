import Link from 'next/link';

import { buildBatchAction } from './actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { FlashMessages } from '@/components/ui/flash';
import { readActiveSeason } from '@/lib/admin/dashboard';
import { requirePermission } from '@/lib/auth/staff';
import { formatCents } from '@/lib/core/money';
import { formatDateTime } from '@/lib/core/dates';
import { ALL_STAGES, readChannelSummaries } from '@/lib/fulfillment/channel-summary';
import { stageLabel } from '@/lib/fulfillment/package-stages';
import { batchPath, BOARD_PATH } from '@/lib/print/paths';
import { countWaitingToPrint, listRecentBatches } from '@/lib/print/print-batch-service';

export const dynamic = 'force-dynamic';

/**
 * The fulfillment dashboard (R-072, R-073, UR-005).
 *
 * One screen per season answering the two questions the office asks in Purim
 * week: how much is there left to make and move, and what came off the printer.
 * The channel table is the production view; the batch list is the paper trail.
 */
export default async function FulfillmentPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; problem?: string }>;
}) {
  const [params, context] = await Promise.all([
    searchParams,
    requirePermission('fulfillment.manage'),
  ]);
  const season = await readActiveSeason();

  if (!season) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Fulfillment</h1>
        <p className="text-sm text-[var(--color-ink-muted)]" data-testid="fulfillment-no-season">
          There is no season yet, so there is nothing to pack.
        </p>
      </div>
    );
  }

  const [{ channels, totals }, batches, waiting] = await Promise.all([
    readChannelSummaries(season.id),
    listRecentBatches(season.id),
    countWaitingToPrint(season.id),
  ]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Fulfillment</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {season.label} · signed in as {context.acting.fullName}
          </p>
        </div>
        <Link href={BOARD_PATH} className="text-sm underline underline-offset-4">
          Open the package board
        </Link>
      </header>

      <FlashMessages notice={params.notice} problem={params.problem} testIdPrefix="fulfillment" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure testId="figure-packages" amount={totals.packageCount} label="Boxes this season" />
        <Figure testId="figure-items" amount={totals.itemCount} label="Items in those boxes" />
        <Figure
          testId="figure-saved"
          amount={totals.savedCents}
          value={formatCents(totals.savedCents)}
          label="Saved by grouping bulk deliveries"
        />
        <Figure testId="figure-waiting" amount={waiting} label="Boxes not yet on a batch" />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">By channel</h2>
        <table className="w-full text-sm" data-testid="channel-table">
          <thead className="text-left text-[var(--color-ink-muted)]">
            <tr>
              <th className="py-2">Channel</th>
              <th className="text-right">Boxes</th>
              <th className="text-right">Items</th>
              {ALL_STAGES.map((stage) => (
                <th key={stage} className="text-right">
                  {stageLabel(stage)}
                </th>
              ))}
              <th className="text-right">Charged</th>
              <th className="text-right">Saved</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((channel) => (
              <tr
                key={channel.methodId}
                className="border-t border-[var(--color-line)]"
                data-testid="channel-row"
                data-channel={channel.code}
                data-packages={channel.packageCount}
                data-items={channel.itemCount}
                data-saved={channel.savedCents}
              >
                <td className="py-2">
                  <Link
                    href={`${BOARD_PATH}?channel=${channel.methodId}`}
                    className="text-[var(--color-brand)] underline underline-offset-4"
                  >
                    {channel.label}
                  </Link>
                </td>
                <td className="text-right">{channel.packageCount}</td>
                <td className="text-right">{channel.itemCount}</td>
                {ALL_STAGES.map((stage) => (
                  <td key={stage} className="text-right">
                    {channel.stageCounts[stage]}
                  </td>
                ))}
                <td className="text-right">{formatCents(channel.chargedCents)}</td>
                <td className="text-right">{formatCents(channel.savedCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Print batches</h2>
          <form action={buildBatchAction}>
            <Button type="submit" data-testid="build-batch">
              Build tonight&rsquo;s batch
            </Button>
          </form>
        </div>

        <p className="text-sm text-[var(--color-ink-muted)]">
          A batch files the boxes that have never been printed into groups and freezes what is in
          each. Printing never moves a box along — Printed, Packed and Sent stay staff decisions.
        </p>

        {batches.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]" data-testid="batches-empty">
            Nothing has been printed yet.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="batch-list">
            {batches.map((batch) => (
              <li
                key={batch.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--color-line)] px-3 py-2 text-sm"
                data-testid="batch-row"
                data-batch-id={batch.id}
                data-packages={batch.packageCount}
              >
                <span className="flex items-center gap-2">
                  <Link
                    href={batchPath(batch.id)}
                    className="text-[var(--color-brand)] underline underline-offset-4"
                  >
                    {batch.label}
                  </Link>
                  <Badge tone={batch.kind === 'NIGHTLY' ? 'neutral' : 'warning'}>{batch.kind}</Badge>
                </span>
                <span className="text-[var(--color-ink-muted)]">
                  {batch.packageCount} box{batch.packageCount === 1 ? '' : 'es'} ·{' '}
                  {batch.groups.length} group{batch.groups.length === 1 ? '' : 's'} ·{' '}
                  {formatDateTime(batch.createdAt)}
                  {batch.createdBy ? ` · ${batch.createdBy}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Figure({
  amount,
  value,
  label,
  testId,
}: {
  amount: number;
  value?: string;
  label: string;
  testId: string;
}) {
  return (
    <Card data-testid={testId} data-value={amount}>
      <CardTitle className="text-2xl">{value ?? amount.toLocaleString('en-US')}</CardTitle>
      <CardDescription>{label}</CardDescription>
    </Card>
  );
}