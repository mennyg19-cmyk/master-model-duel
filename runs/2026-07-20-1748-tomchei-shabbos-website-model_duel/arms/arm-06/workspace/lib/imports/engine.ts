import { ImportBatch, ImportKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { AuditContextLike, recordAudit } from "@/lib/audit";
import { parseCsv } from "@/lib/csv";

// R-063/R-143: staged, atomic CSV import. Stage parses + validates + marks
// duplicates and stores the verdict per row; commit re-checks duplicates
// inside one transaction and createMany's only the still-valid rows — the
// batch lands whole or not at all. Preview reads the staged payload; nothing
// is written to the domain tables before commit.
export const IMPORT_ROW_LIMIT = 2000;

export type RowVerdict = "valid" | "duplicate" | "invalid";

export interface StagedRow {
  /** 1-based data-row number (header is row 0) — stable in previews/audits. */
  row: number;
  data: Record<string, string | number | boolean | null>;
  verdict: RowVerdict;
  reason?: string;
}

export interface ImportPayload {
  rows: StagedRow[];
  /** Products import: the open season captured at stage time. */
  seasonId?: string;
}

export interface DedupeKey {
  /** Unique across key types — prefix with the field (`email:…`, `phone:…`). */
  key: string;
  /** Field name used in the duplicate reason ("email duplicates row 3…"). */
  label: string;
}

export interface KindHandler {
  requiredHeaders: string[];
  /** Pure per-row validation; verdict valid/invalid (duplicates come later). */
  parseRow(rowNumber: number, record: Record<string, string>): StagedRow;
  /** Keys for in-file duplicate detection; empty = row exempt from dedupe. */
  duplicateKeys(data: StagedRow["data"]): DedupeKey[];
  /** Mark rows whose key already exists in the domain table (runs in any tx). */
  markDatabaseDuplicates(tx: Prisma.TransactionClient, rows: StagedRow[]): Promise<void>;
  /** Create the still-valid rows; returns how many actually landed. */
  commitRows(tx: Prisma.TransactionClient, rows: StagedRow[], payload: ImportPayload): Promise<number>;
}

function parseStageRows(kind: KindHandler, csvText: string): StagedRow[] {
  const grid = parseCsv(csvText).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (grid.length === 0) throw new DomainRuleError("The CSV is empty");
  if (grid.length - 1 > IMPORT_ROW_LIMIT) {
    throw new DomainRuleError(`Imports take at most ${IMPORT_ROW_LIMIT} data rows; got ${grid.length - 1}`);
  }

  const headerIndex = new Map(grid[0].map((cell, index) => [cell.trim().toLowerCase(), index]));
  const missing = kind.requiredHeaders.filter((header) => !headerIndex.has(header));
  if (missing.length > 0) {
    throw new DomainRuleError(`Missing required column(s): ${missing.join(", ")}`);
  }

  const rows = grid.slice(1).map((cells, index) => {
    const record: Record<string, string> = {};
    for (const [header, column] of headerIndex) {
      record[header] = (cells[column] ?? "").trim();
    }
    return kind.parseRow(index + 1, record);
  });

  // In-file duplicates: first occurrence keeps its verdict, later copies are
  // reported against it — a doubled paste can never create two rows. A row
  // registers its keys only when NO key collides, so a dropped row never
  // blocks a later legitimate row that happens to share one field with it.
  const firstSeenAt = new Map<string, number>();
  for (const row of rows) {
    if (row.verdict !== "valid") continue;
    const keys = kind.duplicateKeys(row.data);
    const hit = keys.find(({ key }) => firstSeenAt.has(key));
    if (hit) {
      row.verdict = "duplicate";
      row.reason = `${hit.label} duplicates row ${firstSeenAt.get(hit.key)} in this file`;
      continue;
    }
    for (const { key } of keys) firstSeenAt.set(key, row.row);
  }
  return rows;
}

function countByVerdict(rows: StagedRow[]) {
  return {
    totalRows: rows.length,
    validRows: rows.filter((row) => row.verdict === "valid").length,
    duplicateRows: rows.filter((row) => row.verdict === "duplicate").length,
    invalidRows: rows.filter((row) => row.verdict === "invalid").length,
  };
}

export function readPayload(batch: ImportBatch): ImportPayload {
  return batch.payload as unknown as ImportPayload;
}

export async function stageImport(input: {
  kind: ImportKind;
  handler: KindHandler;
  filename: string;
  csvText: string;
  extraPayload?: Partial<ImportPayload>;
  /** G-029: a dry-run batch stages + validates the full ledger but can never commit. */
  dryRun?: boolean;
  ctx: AuditContextLike;
}): Promise<ImportBatch> {
  const rows = parseStageRows(input.handler, input.csvText);
  // Stage-time duplicate marking uses a read-only pass; commit re-checks
  // inside its transaction, so a stale preview can never write a wrong row.
  await prisma.$transaction((tx) => input.handler.markDatabaseDuplicates(tx, rows));

  const payload: ImportPayload = { ...input.extraPayload, rows };
  const counts = countByVerdict(rows);
  return prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({
      data: {
        kind: input.kind,
        filename: input.filename,
        dryRun: input.dryRun ?? false,
        payload: payload as unknown as Prisma.InputJsonValue,
        actorId: input.ctx.staff.id,
        actorEmail: input.ctx.staff.email,
        ...counts,
      },
    });
    await recordAudit(
      {
        ctx: input.ctx,
        action: "import_stage",
        targetType: "ImportBatch",
        targetId: batch.id,
        metadata: { kind: input.kind, filename: input.filename, dryRun: input.dryRun ?? false, ...counts },
      },
      tx,
    );
    return batch;
  });
}

export async function commitImport(input: {
  batchId: string;
  handler: KindHandler;
  ctx: AuditContextLike;
}): Promise<ImportBatch> {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new NotFoundError("ImportBatch", input.batchId);
    if (batch.status !== "STAGED") {
      throw new DomainRuleError(`Import batch ${input.batchId} is ${batch.status}; expected STAGED to commit`);
    }
    if (batch.dryRun) {
      // G-029: dry-run exists precisely to prove the ledger without writing;
      // committing it would be a contradiction. Discard it instead.
      throw new DomainRuleError("This batch is a dry run — it staged and validated only. Re-upload without dry-run to commit.");
    }

    const payload = readPayload(batch);
    // Fresh duplicate check inside the commit transaction: rows that became
    // duplicates since staging are skipped, never written twice.
    await input.handler.markDatabaseDuplicates(tx, payload.rows);
    const committedRows = await input.handler.commitRows(tx, payload.rows, payload);

    const counts = countByVerdict(payload.rows);
    const updated = await tx.importBatch.update({
      where: { id: batch.id },
      data: {
        status: "COMMITTED",
        committedAt: new Date(),
        committedRows,
        payload: payload as unknown as Prisma.InputJsonValue,
        ...counts,
      },
    });
    await recordAudit(
      {
        ctx: input.ctx,
        action: "import_commit",
        targetType: "ImportBatch",
        targetId: batch.id,
        metadata: { kind: batch.kind, committedRows, ...counts },
      },
      tx,
    );
    return updated;
  });
}

export async function discardImport(input: {
  batchId: string;
  ctx: AuditContextLike;
}): Promise<ImportBatch> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.importBatch.updateMany({
      where: { id: input.batchId, status: "STAGED" },
      data: { status: "DISCARDED" },
    });
    if (updated.count === 0) {
      const batch = await tx.importBatch.findUnique({ where: { id: input.batchId } });
      if (!batch) throw new NotFoundError("ImportBatch", input.batchId);
      throw new DomainRuleError(`Import batch ${input.batchId} is ${batch.status}; expected STAGED to discard`);
    }
    await recordAudit(
      {
        ctx: input.ctx,
        action: "import_discard",
        targetType: "ImportBatch",
        targetId: input.batchId,
        metadata: {},
      },
      tx,
    );
    const batch = await tx.importBatch.findUnique({ where: { id: input.batchId } });
    return batch!;
  });
}
