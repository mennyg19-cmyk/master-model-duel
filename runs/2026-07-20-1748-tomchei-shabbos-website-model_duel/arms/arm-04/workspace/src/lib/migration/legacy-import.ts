import 'server-only';

import type { LegacyImportRun, LegacyRowStatus, Prisma } from '@prisma/client';

import { recordAudit } from '../audit';
import type { StaffContext } from '../auth/staff';
import { failure, ok, type Result } from '../core/result';
import { db } from '../db';
import { CsvError, parseCsv } from '../imports/csv';
import { priorYearContext } from '../imports/prior-year-orders';
import {
  assignChunks,
  countVerdicts,
  readVerdicts,
  sourceTotal,
  type LegacyCandidate,
} from './legacy-verdicts';

/**
 * The year-one migration, staging half (R-186, G-029).
 *
 * **The dry run writes nothing anybody can see.** A file exported from a system
 * nobody maintains is read, every line gets a verdict, and the office reads the
 * verdicts. Until somebody presses commit, no customer, address or order has
 * moved — only this run and its own rows exist.
 *
 * The three parts are separate files because they are three jobs: reading a
 * line is `legacy-rows.ts`, deciding what a line is is `legacy-verdicts.ts`,
 * and writing the history down is `legacy-commit.ts`. This file is the staging
 * run and the questions asked about it.
 */
export const LEGACY_BAD_FILE = 'legacy_bad_file';
export const LEGACY_NOT_FOUND = 'legacy_not_found';
export const LEGACY_SETTLED = 'legacy_settled';
export const LEGACY_HAS_QUESTIONS = 'legacy_has_questions';
export const LEGACY_HAS_ERRORS = 'legacy_has_errors';
export const LEGACY_ROW_NOT_FOUND = 'legacy_row_not_found';

export async function dryRunLegacyImport(
  staff: StaffContext,
  input: { fileName: string; content: string; seasonYear: number },
): Promise<Result<LegacyImportRun>> {
  const context = await priorYearContext(input.seasonYear);
  if (!context.ok) return context;

  let rows;
  try {
    rows = parseCsv(input.content).rows;
  } catch (error) {
    if (error instanceof CsvError) return failure(LEGACY_BAD_FILE, error.message);
    throw error;
  }

  const verdicts = await readVerdicts(rows, context.value.seasonId);
  const chunkByReference = assignChunks(verdicts);
  const counts = countVerdicts(verdicts);

  const run = await db.legacyImportRun.create({
    data: {
      fileName: input.fileName.slice(0, 200),
      seasonYear: input.seasonYear,
      rowCount: verdicts.length,
      ...counts,
      chunkCount: new Set(chunkByReference.values()).size,
      sourceTotalCents: sourceTotal(verdicts),
      stagedByStaffUserId: staff.acting.id,
      rows: {
        create: verdicts.map((verdict) => ({
          lineNumber: verdict.lineNumber,
          chunkIndex:
            verdict.orderReference === null ? -1 : (chunkByReference.get(verdict.orderReference) ?? -1),
          status: verdict.status,
          orderReference: verdict.orderReference,
          parsed: (verdict.parsed ?? {}) as unknown as Prisma.InputJsonValue,
          problem: verdict.problem,
          candidates: verdict.candidates as unknown as Prisma.InputJsonValue,
          mappedCustomerId: verdict.mappedCustomerId,
        })),
      },
    },
  });

  await recordAudit(staff, {
    action: 'migration.dry_run',
    entityType: 'LegacyImportRun',
    entityId: run.id,
    detail: {
      fileName: run.fileName,
      seasonYear: run.seasonYear,
      rowCount: run.rowCount,
      invalidCount: run.invalidCount,
      needsMappingCount: run.needsMappingCount,
    },
  });

  return ok(run);
}

export function readLegacyRun(runId: string) {
  return db.legacyImportRun.findUnique({
    where: { id: runId },
    include: {
      stagedBy: { select: { fullName: true } },
      rows: { orderBy: { lineNumber: 'asc' } },
    },
  });
}

export function readLegacyRuns(take = 10) {
  return db.legacyImportRun.findMany({
    include: { stagedBy: { select: { fullName: true } } },
    orderBy: { stagedAt: 'desc' },
    take,
  });
}

/**
 * A person says which household an ambiguous row meant.
 *
 * Only the households the dry run put forward are accepted. The screen offers
 * exactly those, but the screen is not the guard: a hand-made post could
 * otherwise hang a decade of somebody else's history on any customer id in the
 * database, and the audit row would say a manager did it on purpose.
 */
export async function mapLegacyRow(
  staff: StaffContext,
  input: { runId: string; lineNumber: number; customerId: string },
): Promise<Result<{ runId: string }>> {
  const row = await db.legacyImportRow.findUnique({
    where: { runId_lineNumber: { runId: input.runId, lineNumber: input.lineNumber } },
  });
  if (!row || row.status !== 'NEEDS_MAPPING') {
    return failure(LEGACY_ROW_NOT_FOUND, 'That line is not waiting for an answer.');
  }

  const candidates = (row.candidates ?? []) as unknown as LegacyCandidate[];
  if (!candidates.some((candidate) => candidate.id === input.customerId)) {
    return failure(
      LEGACY_ROW_NOT_FOUND,
      'That household is not one of the ones this line could be. Reload the run and choose again.',
    );
  }

  const customer = await db.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) return failure(LEGACY_ROW_NOT_FOUND, 'That customer is no longer on file.');

  await db.legacyImportRow.update({
    where: { id: row.id },
    data: { status: 'VALID', mappedCustomerId: customer.id, problem: null },
  });

  await refreshCounts(input.runId);

  await recordAudit(staff, {
    action: 'migration.row_mapped',
    entityType: 'LegacyImportRun',
    entityId: input.runId,
    detail: { runId: input.runId, lineNumber: input.lineNumber },
  });

  return ok({ runId: input.runId });
}

export async function discardLegacyImport(
  staff: StaffContext,
  runId: string,
): Promise<Result<{ runId: string }>> {
  const discarded = await db.legacyImportRun.updateMany({
    where: { id: runId, status: 'DRY_RUN' },
    data: { status: 'DISCARDED' },
  });

  if (discarded.count === 0) {
    return failure(LEGACY_SETTLED, 'That run has already been committed or thrown away.');
  }

  const run = await db.legacyImportRun.findUniqueOrThrow({ where: { id: runId } });

  await recordAudit(staff, {
    action: 'migration.discarded',
    entityType: 'LegacyImportRun',
    entityId: runId,
    detail: { fileName: run.fileName, rowCount: run.rowCount },
  });

  return ok({ runId });
}

/** Answering a question changes the counts the commit gate reads. */
async function refreshCounts(runId: string): Promise<void> {
  const grouped = await db.legacyImportRow.groupBy({
    by: ['status'],
    where: { runId },
    _count: { _all: true },
  });

  const countOf = (status: LegacyRowStatus) =>
    grouped.find((row) => row.status === status)?._count._all ?? 0;

  await db.legacyImportRun.update({
    where: { id: runId },
    data: {
      validCount: countOf('VALID'),
      duplicateCount: countOf('DUPLICATE'),
      needsMappingCount: countOf('NEEDS_MAPPING'),
      invalidCount: countOf('INVALID'),
    },
  });
}
