import { notFound } from 'next/navigation';

import {
  commitLegacyImportAction,
  discardLegacyImportAction,
  mapLegacyRowAction,
} from '../actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/field';
import { Figure } from '@/components/ui/figure';
import { FlashMessages } from '@/components/ui/flash';
import { requirePermission } from '@/lib/auth/staff';
import { formatDateTime } from '@/lib/core/dates';
import { formatCents } from '@/lib/core/money';
import { readLegacyRun } from '@/lib/migration/legacy-import';
import type { LegacyCandidate } from '@/lib/migration/legacy-verdicts';

export const dynamic = 'force-dynamic';

const SHOWN_ROWS = 100;

/**
 * What the file is going to do, before it does any of it (G-029).
 *
 * The two numbers that matter are at the top: what the old system said these
 * orders were worth, and what this database holds for them. Equal after a
 * commit means the migration reconciles; anything else is a conversation the
 * office needs to have before the season opens.
 */
export default async function LegacyRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ notice?: string; problem?: string }>;
}) {
  const [{ runId }, flash] = await Promise.all([params, searchParams, requirePermission('migration.manage')]);

  const run = await readLegacyRun(runId);
  if (!run) notFound();

  const questions = run.rows.filter((row) => row.status === 'NEEDS_MAPPING');
  const problems = run.rows.filter((row) => row.status === 'INVALID');
  const isSettled = run.status === 'COMMITTED' || run.status === 'DISCARDED';
  const difference = run.importedTotalCents - run.sourceTotalCents;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{run.fileName}</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          {run.seasonYear} · read {formatDateTime(run.stagedAt)}
          {run.stagedBy ? ` by ${run.stagedBy.fullName}` : ''} ·{' '}
          <Badge tone={run.status === 'COMMITTED' ? 'success' : 'neutral'}>{run.status}</Badge>
        </p>
      </header>

      <FlashMessages notice={flash.notice} problem={flash.problem} testIdPrefix="migration-run" />

      <dl className="grid gap-3 sm:grid-cols-4" data-testid="run-counts">
        <Figure label="Rows" value={String(run.rowCount)} />
        <Figure label="Ready" value={String(run.validCount)} testId="run-valid" />
        <Figure label="Already here" value={String(run.duplicateCount)} />
        <Figure
          label="Cannot be read"
          value={String(run.invalidCount)}
          tone={run.invalidCount > 0 ? 'warning' : undefined}
        />
      </dl>

      <Card>
        <CardTitle>Reconciliation</CardTitle>
        <CardDescription>
          The file says {formatCents(run.sourceTotalCents)}. This database now holds{' '}
          {formatCents(run.importedTotalCents)} for these orders
          {run.status === 'COMMITTED' ? '' : ', and will until the commit finishes'}.
        </CardDescription>

        <p className="mt-2 text-sm" data-testid="run-difference">
          Difference: <strong>{formatCents(difference)}</strong>
          {run.status === 'COMMITTED' && difference !== 0 ? (
            <span className="text-[var(--color-danger)]"> — this needs explaining before the season opens.</span>
          ) : null}
        </p>

        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          {run.ordersWritten} orders, {run.orderLinesWritten} lines, {run.customersWritten} new customers,{' '}
          {run.addressesWritten} address book entries. Batches {run.committedChunkCount} of {run.chunkCount}.
        </p>

        {isSettled ? null : (
          <div className="mt-4 flex flex-wrap gap-2">
            <form action={commitLegacyImportAction}>
              <input type="hidden" name="runId" value={run.id} />
              <Button type="submit" disabled={questions.length > 0} data-testid="run-commit">
                {run.committedChunkCount === 0 ? 'Commit it' : 'Continue'}
              </Button>
            </form>

            {run.committedChunkCount === 0 ? (
              <form action={discardLegacyImportAction}>
                <input type="hidden" name="runId" value={run.id} />
                <Button type="submit" variant="secondary" data-testid="run-discard">
                  Throw it away
                </Button>
              </form>
            ) : null}
          </div>
        )}

        {questions.length > 0 ? (
          <p className="mt-2 text-sm text-[var(--color-warning)]">
            {questions.length} line{questions.length === 1 ? '' : 's'} still need a customer chosen.
          </p>
        ) : null}
      </Card>

      {questions.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Which household is this?</h2>
          <table className="w-full text-sm" data-testid="run-questions">
            <tbody>
              {questions.map((row) => (
                <tr key={row.id} className="border-t border-[var(--color-line)]">
                  <td className="py-2 align-top">Line {row.lineNumber}</td>
                  <td className="align-top text-[var(--color-ink-muted)]">{row.problem}</td>
                  <td className="py-2">
                    <form action={mapLegacyRowAction} className="flex items-center gap-2">
                      <input type="hidden" name="runId" value={run.id} />
                      <input type="hidden" name="lineNumber" value={row.lineNumber} />
                      <Select name="customerId" defaultValue="" aria-label={`Customer for line ${row.lineNumber}`}>
                        <option value="" disabled>
                          Choose…
                        </option>
                        {candidatesOf(row.candidates).map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.label}
                          </option>
                        ))}
                      </Select>
                      <Button type="submit" variant="secondary">
                        Match
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {problems.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Lines that will be left behind</h2>
          <ul className="space-y-1 text-sm" data-testid="run-problems">
            {problems.slice(0, SHOWN_ROWS).map((row) => (
              <li key={row.id}>
                <span className="text-[var(--color-ink-muted)]">Line {row.lineNumber}:</span> {row.problem}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function candidatesOf(raw: unknown): LegacyCandidate[] {
  return Array.isArray(raw) ? (raw as LegacyCandidate[]) : [];
}