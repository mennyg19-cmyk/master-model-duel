import 'server-only';

import type { ImportBatch, ImportKind, ImportRowStatus, Prisma } from '@prisma/client';

import { recordAudit } from '../audit';
import type { StaffContext } from '../auth/staff';
import { normalizeEmail } from '../core/normalize';
import { normalizePhone } from '../core/phone';
import { failure, ok, type Result } from '../core/result';
import { db } from '../db';
import { abort, runInTransaction } from '../transaction';
import { CsvError, parseCsv, type CsvTable } from './csv';
import { readCustomerRow, readProductRow, type StagedRow } from './row-readers';

/**
 * Staged, previewed, then applied in one transaction (R-063, R-143).
 *
 * A spreadsheet is somebody's afternoon of typing, and applying it row by row
 * as it is read is how half a customer list ends up imported with the other
 * half rejected and nobody sure where the line was. So staging writes verdicts
 * and changes nothing; a person reads the preview; and the commit is one
 * transaction that either writes every row or writes none.
 *
 * A row that names a record already on file is a `DUPLICATE`, not an error —
 * re-exporting last year's list to correct three phone numbers is the normal
 * use — and the commit updates it. A row nobody can act on is `INVALID` and
 * blocks the whole batch, because a partial import is the thing this module
 * exists to prevent.
 */
export const IMPORT_BAD_FILE = 'import_bad_file';
export const IMPORT_NOT_FOUND = 'import_not_found';
export const IMPORT_ALREADY_SETTLED = 'import_already_settled';
export const IMPORT_HAS_ERRORS = 'import_has_errors';
export const IMPORT_SEASON_REQUIRED = 'import_season_required';

export type StagedBatch = ImportBatch & { rows: StagedRowRecord[] };

export type StagedRowRecord = {
  lineNumber: number;
  status: ImportRowStatus;
  parsed: Record<string, string>;
  problem: string | null;
  matchedId: string | null;
};

export async function stageImport(
  staff: StaffContext,
  input: { kind: ImportKind; fileName: string; content: string; seasonId: string | null },
): Promise<Result<StagedBatch>> {
  let table: CsvTable;
  try {
    table = parseCsv(input.content);
  } catch (error) {
    if (error instanceof CsvError) return failure(IMPORT_BAD_FILE, error.message);
    throw error;
  }

  let rows: StagedRow[];
  if (input.kind === 'CUSTOMERS') {
    rows = await readCustomerRows(table);
  } else if (input.seasonId === null) {
    return failure(IMPORT_SEASON_REQUIRED, 'Choose the season these products belong to.');
  } else {
    rows = await readProductRows(table, input.seasonId);
  }

  const counts = countRows(rows);

  const batch = await db.importBatch.create({
    data: {
      kind: input.kind,
      fileName: input.fileName.slice(0, 200),
      seasonId: input.seasonId,
      stagedByStaffUserId: staff.actor.id,
      rowCount: rows.length,
      ...counts,
      rows: {
        create: rows.map((row) => ({
          lineNumber: row.lineNumber,
          status: row.status,
          parsed: row.parsed as Prisma.InputJsonValue,
          problem: row.problem,
          matchedId: row.matchedId,
        })),
      },
    },
  });

  await recordAudit(staff, {
    action: 'import.staged',
    entityType: 'ImportBatch',
    entityId: batch.id,
    detail: { kind: input.kind, fileName: batch.fileName, rowCount: rows.length, ...counts },
  });

  return ok({ ...batch, rows });
}

export async function readBatch(batchId: string): Promise<StagedBatch | null> {
  const batch = await db.importBatch.findUnique({
    where: { id: batchId },
    include: { rows: { orderBy: { lineNumber: 'asc' } } },
  });
  if (!batch) return null;

  return {
    ...batch,
    rows: batch.rows.map((row) => ({
      lineNumber: row.lineNumber,
      status: row.status,
      parsed: (row.parsed ?? {}) as Record<string, string>,
      problem: row.problem,
      matchedId: row.matchedId,
    })),
  };
}

export type CommitResult = { createdCount: number; updatedCount: number };

/**
 * Writes the batch. Every row, or none of them.
 *
 * The verdicts are re-read from the staged rows rather than taken from the
 * screen that posted the button, and the matched record is looked up again
 * inside the transaction: between the preview and the click, somebody else may
 * have created the customer this row was going to create.
 */
export async function commitImport(
  staff: StaffContext,
  batchId: string,
): Promise<Result<CommitResult>> {
  const batch = await readBatch(batchId);
  if (!batch) return failure(IMPORT_NOT_FOUND, 'That import is no longer here.');
  if (batch.status !== 'STAGED') {
    return failure(IMPORT_ALREADY_SETTLED, `This import was already ${batch.status.toLowerCase()}.`);
  }
  if (batch.invalidCount > 0) {
    return failure(
      IMPORT_HAS_ERRORS,
      `${batch.invalidCount} row${batch.invalidCount === 1 ? '' : 's'} cannot be imported. Fix the file and upload it again.`,
    );
  }

  const committed = await runInTransaction(async (tx) => {
    const written = await writeBatch(tx, batch);

    const claimed = await tx.importBatch.updateMany({
      where: { id: batch.id, status: 'STAGED' },
      data: { status: 'COMMITTED', committedAt: new Date(), ...written },
    });

    // Two people pressing commit on the same preview: the second changes
    // nothing and is told so, rather than importing the file twice.
    if (claimed.count === 0) {
      abort(failure(IMPORT_ALREADY_SETTLED, 'Somebody else committed this import already.'));
    }

    await recordAudit(
      staff,
      {
        action: 'import.committed',
        entityType: 'ImportBatch',
        entityId: batch.id,
        detail: { kind: batch.kind, ...written },
      },
      tx,
    );

    return written;
  });

  return committed;
}

/** Throwing away a preview nobody wants. Nothing was written, so nothing unwinds. */
export async function discardImport(
  staff: StaffContext,
  batchId: string,
): Promise<Result<ImportBatch>> {
  const discarded = await db.importBatch.updateMany({
    where: { id: batchId, status: 'STAGED' },
    data: { status: 'DISCARDED' },
  });

  if (discarded.count === 0) {
    return failure(IMPORT_ALREADY_SETTLED, 'That import has already been dealt with.');
  }

  const batch = await db.importBatch.findUniqueOrThrow({ where: { id: batchId } });

  await recordAudit(staff, {
    action: 'import.discarded',
    entityType: 'ImportBatch',
    entityId: batch.id,
    detail: { kind: batch.kind, rowCount: batch.rowCount },
  });

  return ok(batch);
}

/**
 * Products need a season and customers must not have one applied to them, and
 * `abort` is how a batch whose season went away between staging and committing
 * rolls back rather than writing half of itself.
 */
async function writeBatch(
  tx: Prisma.TransactionClient,
  batch: StagedBatch,
): Promise<CommitResult> {
  if (batch.kind === 'CUSTOMERS') return writeCustomers(tx, batch.rows);

  if (batch.seasonId === null) {
    abort(failure(IMPORT_SEASON_REQUIRED, 'This import has no season on it any more.'));
  }

  return writeProducts(tx, batch.rows, batch.seasonId);
}

type CustomerWrite = {
  fullName: string;
  email: string;
  normalizedEmail: string;
  phone: string | null;
  normalizedPhone: string | null;
};

async function writeCustomers(
  tx: Prisma.TransactionClient,
  rows: StagedRowRecord[],
): Promise<CommitResult> {
  const writes = rows.map(toCustomerWrite);

  // Read every record this batch could touch once, up front. Five thousand rows
  // times three lookups was five thousand round trips holding the commit's locks
  // open while it made them.
  const onFile = await tx.customer.findMany({
    where: {
      OR: [
        { normalizedEmail: { in: writes.map((write) => write.normalizedEmail) } },
        { normalizedPhone: { in: digitsOf(writes) } },
      ],
    },
    select: { id: true, normalizedEmail: true, normalizedPhone: true },
  });

  const byEmail = new Map(onFile.map((row) => [row.normalizedEmail, row]));
  const phonesTaken = new Set(
    onFile.flatMap((row) => (row.normalizedPhone === null ? [] : [row.normalizedPhone])),
  );
  const byPhone = new Map(
    onFile.flatMap((row) => (row.normalizedPhone === null ? [] : [[row.normalizedPhone, row] as const])),
  );

  let createdCount = 0;
  let updatedCount = 0;

  for (const write of writes) {
    const matchedByEmail = byEmail.get(write.normalizedEmail);
    const matchedByPhone =
      write.normalizedPhone === null ? undefined : byPhone.get(write.normalizedPhone);
    const existing = matchedByEmail ?? matchedByPhone;

    // The phone is only written when nobody holds it: the unique index is what
    // keeps two households from merging, and an import must not be the thing
    // that quietly steals a number off another record (R-144).
    const claimsPhone =
      write.normalizedPhone !== null &&
      write.phone !== null &&
      !phonesTaken.has(write.normalizedPhone);

    const phoneFields = claimsPhone
      ? { phone: write.phone, normalizedPhone: write.normalizedPhone }
      : {};

    if (existing) {
      await tx.customer.update({
        where: { id: existing.id },
        data: {
          // A row that only matched on the phone number is somebody else's
          // record as far as the file is concerned: the operator typed a name
          // next to a number, not a correction to the name on file. Renaming it
          // from here would overwrite a real customer's name with no way back.
          ...(matchedByEmail ? { fullName: write.fullName } : {}),
          ...phoneFields,
        },
      });
      updatedCount += 1;
    } else {
      await tx.customer.create({
        data: {
          fullName: write.fullName,
          email: write.email,
          normalizedEmail: write.normalizedEmail,
          ...phoneFields,
        },
      });
      createdCount += 1;
    }

    // Two rows of one file reaching for the same number: the first takes it.
    if (claimsPhone && write.normalizedPhone !== null) phonesTaken.add(write.normalizedPhone);
  }

  return { createdCount, updatedCount };
}

function toCustomerWrite(row: StagedRowRecord): CustomerWrite {
  const email = row.parsed.email;
  const phone = row.parsed.phone || null;

  return {
    fullName: row.parsed.fullname,
    email: email.trim(),
    normalizedEmail: normalizeEmail(email),
    phone,
    normalizedPhone: phone === null ? null : normalizePhone(phone),
  };
}

function digitsOf(writes: CustomerWrite[]): string[] {
  return writes.flatMap((write) => (write.normalizedPhone === null ? [] : [write.normalizedPhone]));
}

async function writeProducts(
  tx: Prisma.TransactionClient,
  rows: StagedRowRecord[],
  seasonId: string,
): Promise<CommitResult> {
  const slugs = rows.map((row) => row.parsed.slug);
  const onFile = await tx.product.findMany({
    where: { seasonId, slug: { in: slugs } },
    select: { id: true, slug: true },
  });

  const bySlug = new Map(onFile.map((row) => [row.slug, row]));

  let createdCount = 0;
  let updatedCount = 0;

  for (const row of rows) {
    const slug = row.parsed.slug;
    const data = {
      name: row.parsed.name,
      priceCents: Number(row.parsed.pricecents),
      category: row.parsed.category || null,
    };

    const existing = bySlug.get(slug);

    if (existing) {
      await tx.product.update({ where: { id: existing.id }, data });
      updatedCount += 1;
      continue;
    }

    await tx.product.create({ data: { seasonId, slug, ...data } });
    createdCount += 1;
  }

  return { createdCount, updatedCount };
}

async function readCustomerRows(table: CsvTable): Promise<StagedRow[]> {
  const seenEmails = new Set<string>();
  const rows: StagedRow[] = [];

  for (const row of table.rows) {
    rows.push(await readCustomerRow(row, seenEmails));
  }

  return rows;
}

async function readProductRows(table: CsvTable, seasonId: string): Promise<StagedRow[]> {
  const seenSlugs = new Set<string>();
  const rows: StagedRow[] = [];

  for (const row of table.rows) {
    rows.push(await readProductRow(row, seasonId, seenSlugs));
  }

  return rows;
}

function countRows(rows: StagedRow[]) {
  return {
    validCount: rows.filter((row) => row.status === 'VALID').length,
    duplicateCount: rows.filter((row) => row.status === 'DUPLICATE').length,
    invalidCount: rows.filter((row) => row.status === 'INVALID').length,
  };
}
