import { notFound } from 'next/navigation';

import { commitImportAction, discardImportAction } from '../actions';
import { BackLink } from '@/components/admin/list-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { FlashMessages } from '@/components/ui/flash';
import { requirePermission } from '@/lib/auth/staff';
import { formatDateTime } from '@/lib/core/dates';
import { readBatch, type StagedRowRecord } from '@/lib/imports/import-service';

export const dynamic = 'force-dynamic';

/** How much of a long file is worth reading on screen before fixing it instead. */
const ROWS_SHOWN = 200;

const ROW_TONES = { VALID: 'success', DUPLICATE: 'warning', INVALID: 'danger' } as const;

/**
 * The preview (R-063).
 *
 * Every row's verdict, in file order, with the reason next to the ones that
 * cannot be imported. Nothing on this page has changed the database yet, and
 * the commit button stays shut while a single row is unreadable — a half-applied
 * customer list is the failure this pipeline exists to prevent.
 */
export default async function ImportPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<{ notice?: string; problem?: string }>;
}) {
  const [{ batchId }, query] = await Promise.all([
    params,
    searchParams,
    requirePermission('imports.manage'),
  ]);

  const batch = await readBatch(batchId);
  if (!batch) notFound();

  const isStaged = batch.status === 'STAGED';
  const canCommit = isStaged && batch.invalidCount === 0;
  const shown = batch.rows.slice(0, ROWS_SHOWN);

  return (
    <div
      className="space-y-6"
      data-testid="import-preview"
      data-status={batch.status}
      data-valid={batch.validCount}
      data-duplicate={batch.duplicateCount}
      data-invalid={batch.invalidCount}
    >
      <BackLink href="/admin/imports">Imports</BackLink>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{batch.fileName}</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          {batch.kind === 'CUSTOMERS' ? 'Customers' : 'Products'} · staged{' '}
          {formatDateTime(batch.stagedAt)} ·{' '}
          <Badge tone={batch.status === 'COMMITTED' ? 'success' : 'neutral'}>{batch.status}</Badge>
        </p>
      </header>

      <FlashMessages notice={query.notice} problem={query.problem} testIdPrefix="import" />

      <Card>
        <CardTitle>What this file will do</CardTitle>
        <dl className="mt-3 grid gap-3 sm:grid-cols-4 text-sm">
          <Count label="Rows" value={batch.rowCount} />
          <Count label="New" value={batch.validCount} testId="count-valid" />
          <Count label="Updates existing" value={batch.duplicateCount} testId="count-duplicate" />
          <Count label="Cannot import" value={batch.invalidCount} testId="count-invalid" />
        </dl>

        {batch.status === 'COMMITTED' ? (
          <CardDescription className="mt-4" data-testid="import-result">
            Committed {batch.committedAt ? formatDateTime(batch.committedAt) : ''} — created{' '}
            {batch.createdCount}, updated {batch.updatedCount}.
          </CardDescription>
        ) : null}

        {isStaged ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <form action={commitImportAction}>
              <input type="hidden" name="batchId" value={batch.id} />
              <Button type="submit" disabled={!canCommit} data-testid="import-commit">
                Import {batch.rowCount} row{batch.rowCount === 1 ? '' : 's'}
              </Button>
            </form>

            <form action={discardImportAction}>
              <input type="hidden" name="batchId" value={batch.id} />
              <Button type="submit" variant="ghost" data-testid="import-discard">
                Throw it away
              </Button>
            </form>

            {canCommit ? null : (
              <p className="text-sm text-[var(--color-danger)]" data-testid="import-blocked">
                Fix the rows below in the spreadsheet and upload it again. Nothing is imported until
                every row can be.
              </p>
            )}
          </div>
        ) : null}
      </Card>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Rows</h2>
        <table className="w-full text-sm" data-testid="import-rows">
          <thead className="text-left text-[var(--color-ink-muted)]">
            <tr>
              <th className="py-2 w-16">Line</th>
              <th className="w-28">Verdict</th>
              <th>What is in it</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <ImportRow key={row.lineNumber} row={row} />
            ))}
          </tbody>
        </table>

        {batch.rows.length > shown.length ? (
          <p className="text-sm text-[var(--color-ink-muted)]">
            Showing the first {ROWS_SHOWN.toLocaleString('en-US')} of{' '}
            {batch.rows.length.toLocaleString('en-US')} rows.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function ImportRow({ row }: { row: StagedRowRecord }) {
  return (
    <tr className="border-t border-[var(--color-line)]" data-testid="import-row" data-status={row.status}>
      <td className="py-2">{row.lineNumber}</td>
      <td>
        <Badge tone={ROW_TONES[row.status]}>{row.status}</Badge>
      </td>
      <td>
        <span>
          {Object.entries(row.parsed)
            .map(([key, value]) => `${key}: ${value}`)
            .join(' · ') || '—'}
        </span>
        {row.problem ? (
          <p className="text-[var(--color-danger)]" data-testid="import-row-problem">
            {row.problem}
          </p>
        ) : null}
      </td>
    </tr>
  );
}

function Count({ label, value, testId }: { label: string; value: number; testId?: string }) {
  return (
    <div>
      <dt className="text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="text-lg font-semibold" data-testid={testId}>
        {value.toLocaleString('en-US')}
      </dd>
    </div>
  );
}
