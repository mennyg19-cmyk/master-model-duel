import Link from 'next/link';

import { dryRunLegacyImportAction } from './actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Label, Select } from '@/components/ui/field';
import { FlashMessages } from '@/components/ui/flash';
import { requirePermission } from '@/lib/auth/staff';
import { formatDateTime } from '@/lib/core/dates';
import { db } from '@/lib/db';
import { CSV_MAX_ROWS } from '@/lib/imports/csv';
import { countOpenCleanupFlags } from '@/lib/migration/address-cleanup';
import { readLegacyRuns } from '@/lib/migration/legacy-import';
import { LEGACY_COLUMNS } from '@/lib/migration/legacy-rows';

export const dynamic = 'force-dynamic';

/**
 * Bringing a decade of history across (R-186, G-029).
 *
 * Uploading reads the file and writes verdicts. It does not write a single
 * customer, address or order — that is a second, separate press, on a screen
 * where somebody has read what the file is going to do.
 */
export default async function MigrationPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; problem?: string }>;
}) {
  const [params] = await Promise.all([searchParams, requirePermission('migration.manage')]);

  const [seasons, runs, openFlags] = await Promise.all([
    db.season.findMany({ orderBy: { year: 'desc' } }),
    readLegacyRuns(),
    countOpenCleanupFlags(),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Migration</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          The old system&apos;s orders, read carefully and written in batches.
        </p>
      </header>

      <FlashMessages notice={params.notice} problem={params.problem} testIdPrefix="migration" />

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Address book cleanup</CardTitle>
          <CardDescription>
            {openFlags === 0
              ? 'Nothing is waiting. Run a scan after an import.'
              : `${openFlags} address${openFlags === 1 ? '' : 'es'} need a decision.`}
          </CardDescription>
        </div>

        <Link
          href="/admin/migration/cleanup"
          className="inline-flex items-center justify-center rounded-md border border-[var(--color-line)] bg-white px-3.5 py-2 text-sm font-medium hover:bg-[var(--color-surface-muted)]"
          data-testid="cleanup-link"
        >
          Open the queue
        </Link>
      </Card>

      <Card>
        <CardTitle>Upload the legacy export</CardTitle>
        <CardDescription>
          One line per item sent, up to {CSV_MAX_ROWS.toLocaleString('en-US')} of them. Columns:{' '}
          <code>{LEGACY_COLUMNS}</code>
        </CardDescription>

        <form action={dryRunLegacyImportAction} className="mt-4 grid gap-3 sm:grid-cols-3 sm:items-end">
          <div>
            <Label htmlFor="seasonYear">Which season is this history</Label>
            <Select id="seasonYear" name="seasonYear" defaultValue={seasons[0]?.year ?? ''}>
              {seasons.map((season) => (
                <option key={season.id} value={season.year}>
                  {season.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="file">CSV file</Label>
            <input
              id="file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              required
              className="w-full text-sm"
            />
          </div>

          <Button type="submit" data-testid="migration-dry-run">
            Read it (writes nothing)
          </Button>
        </form>
      </Card>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Runs</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">Nothing has been read yet.</p>
        ) : (
          <table className="w-full text-sm" data-testid="migration-runs">
            <thead className="text-left text-[var(--color-ink-muted)]">
              <tr>
                <th className="py-2">File</th>
                <th>Season</th>
                <th>Read</th>
                <th className="text-right">Rows</th>
                <th className="text-right">Questions</th>
                <th className="text-right">Batches</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-t border-[var(--color-line)]">
                  <td className="py-2">
                    <Link href={`/admin/migration/${run.id}`} className="underline underline-offset-4">
                      {run.fileName}
                    </Link>
                  </td>
                  <td>{run.seasonYear}</td>
                  <td className="text-[var(--color-ink-muted)]">
                    {formatDateTime(run.stagedAt)}
                    {run.stagedBy ? ` · ${run.stagedBy.fullName}` : ''}
                  </td>
                  <td className="text-right">{run.rowCount}</td>
                  <td className="text-right">{run.needsMappingCount}</td>
                  <td className="text-right">
                    {run.committedChunkCount}/{run.chunkCount}
                  </td>
                  <td>
                    <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function statusTone(status: string): 'success' | 'warning' | 'neutral' {
  if (status === 'COMMITTED') return 'success';
  if (status === 'COMMITTING') return 'warning';
  return 'neutral';
}
