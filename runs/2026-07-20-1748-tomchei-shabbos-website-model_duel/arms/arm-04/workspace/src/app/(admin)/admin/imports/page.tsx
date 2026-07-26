import Link from 'next/link';

import { stageImportAction } from './actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Label, Select } from '@/components/ui/field';
import { FlashMessages } from '@/components/ui/flash';
import { requirePermission } from '@/lib/auth/staff';
import { formatDateTime } from '@/lib/core/dates';
import { db } from '@/lib/db';
import { CSV_MAX_ROWS } from '@/lib/imports/csv';
import { IMPORT_COLUMNS } from '@/lib/imports/row-readers';

export const dynamic = 'force-dynamic';

const RECENT_BATCHES = 20;

/**
 * Bringing a spreadsheet in (R-063, R-143).
 *
 * Uploading stages and previews; it never writes the records. That separation
 * is the whole feature: the person who exported last year's list gets to see
 * what the file will do — which rows are new, which update somebody already on
 * file, which cannot be read at all — before anything happens.
 */
export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; problem?: string }>;
}) {
  const [params] = await Promise.all([searchParams, requirePermission('imports.manage')]);

  const [seasons, batches] = await Promise.all([
    db.season.findMany({ orderBy: { year: 'desc' }, take: 10 }),
    db.importBatch.findMany({
      include: { stagedBy: { select: { fullName: true } } },
      orderBy: { stagedAt: 'desc' },
      take: RECENT_BATCHES,
    }),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Imports</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Upload a CSV, read what it is going to do, then commit it in one go.
        </p>
      </header>

      <FlashMessages notice={params.notice} problem={params.problem} testIdPrefix="imports" />

      <Card>
        <CardTitle>Upload a file</CardTitle>
        <CardDescription>
          Up to {CSV_MAX_ROWS.toLocaleString('en-US')} rows. Customers need{' '}
          <code>{IMPORT_COLUMNS.CUSTOMERS}</code>; products need{' '}
          <code>{IMPORT_COLUMNS.PRODUCTS}</code>.
        </CardDescription>

        <form action={stageImportAction} className="mt-4 grid gap-3 sm:grid-cols-4 sm:items-end">
          <div>
            <Label htmlFor="kind">What is in it</Label>
            <Select id="kind" name="kind" defaultValue="CUSTOMERS">
              <option value="CUSTOMERS">Customers</option>
              <option value="PRODUCTS">Products</option>
            </Select>
          </div>

          <div>
            <Label htmlFor="seasonId">Season (products only)</Label>
            <Select id="seasonId" name="seasonId" defaultValue="">
              <option value="">—</option>
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
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

          <Button type="submit" data-testid="import-stage">
            Stage it
          </Button>
        </form>
      </Card>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Recent imports</h2>
        {batches.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">Nothing has been imported yet.</p>
        ) : (
          <table className="w-full text-sm" data-testid="import-table">
            <thead className="text-left text-[var(--color-ink-muted)]">
              <tr>
                <th className="py-2">File</th>
                <th>Kind</th>
                <th>Staged</th>
                <th>Rows</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch.id} className="border-t border-[var(--color-line)]">
                  <td className="py-2">
                    <Link
                      href={`/admin/imports/${batch.id}`}
                      className="underline underline-offset-4"
                    >
                      {batch.fileName}
                    </Link>
                  </td>
                  <td>{batch.kind === 'CUSTOMERS' ? 'Customers' : 'Products'}</td>
                  <td className="text-[var(--color-ink-muted)]">
                    {formatDateTime(batch.stagedAt)}
                    {batch.stagedBy ? ` · ${batch.stagedBy.fullName}` : ''}
                  </td>
                  <td>{batch.rowCount}</td>
                  <td>
                    <Badge tone={batch.status === 'COMMITTED' ? 'success' : 'neutral'}>
                      {batch.status}
                    </Badge>
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
