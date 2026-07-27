import 'server-only';

import type { LegacyImportRun, Prisma } from '@prisma/client';

import { recordAudit } from '../audit';
import type { StaffContext } from '../auth/staff';
import { failure, ok, type Result } from '../core/result';
import { db } from '../db';
import {
  priorYearContext,
  writePriorYearOrder,
  type PriorYearLine,
  type PriorYearOrder,
} from '../imports/prior-year-orders';
import { abort, runInTransaction } from '../transaction';
import { LEGACY_HAS_QUESTIONS, LEGACY_NOT_FOUND, LEGACY_SETTLED } from './legacy-import';
import type { LegacyParsedRow } from './legacy-rows';

/**
 * Writing the staged history down (R-186, G-029).
 *
 * **The commit is atomic per chunk, and a chunk is a whole number of orders.**
 * One transaction around forty thousand lines either times out or holds the
 * order table for minutes in the week it is least affordable; a row-at-a-time
 * commit leaves half a decade of history imported and the other half not.
 * Chunks are the middle: nothing can ever land half an order, and
 * `committedChunkCount` is what a run that died halfway resumes from.
 *
 * The per-order write itself is `writePriorYearOrder`, shared with P10's
 * single-order hook, so the pipeline and the hook cannot drift apart on what a
 * historic order looks like.
 */
export type LegacyCommitProgress = {
  committedChunkCount: number;
  chunkCount: number;
  isFinished: boolean;
  ordersWritten: number;
};

/**
 * How many chunks one press of Commit gets through. A deployment kills a
 * request that runs too long, and a commit that is killed must leave a run that
 * can be continued rather than a half-imported decade — so the bound is here,
 * in front of the timeout, and the screen offers Continue until it is done.
 */
export const MAX_CHUNKS_PER_COMMIT = 3;

/**
 * Commits up to `MAX_CHUNKS_PER_COMMIT` chunks and reports where it got to.
 *
 * Each chunk claims itself with a guarded update — `committedChunkCount` must
 * still be the value this iteration read — so two people pressing Commit at the
 * same time cannot write the same five orders twice.
 */
export async function commitLegacyImport(
  staff: StaffContext,
  runId: string,
  options: { maxChunks?: number } = {},
): Promise<Result<LegacyCommitProgress>> {
  const run = await db.legacyImportRun.findUnique({ where: { id: runId } });
  if (!run) return failure(LEGACY_NOT_FOUND, 'That import run is no longer here.');
  if (run.status === 'COMMITTED' || run.status === 'DISCARDED') {
    return failure(LEGACY_SETTLED, `This run was already ${run.status.toLowerCase()}.`);
  }
  if (run.needsMappingCount > 0) {
    return failure(
      LEGACY_HAS_QUESTIONS,
      `${run.needsMappingCount} line${run.needsMappingCount === 1 ? ' still needs' : 's still need'} a customer chosen.`,
    );
  }

  const context = await priorYearContext(run.seasonYear);
  if (!context.ok) return context;

  const startedAt = run.committedChunkCount;
  const limit = Math.min(
    run.chunkCount,
    startedAt + (options.maxChunks ?? MAX_CHUNKS_PER_COMMIT),
  );

  let ordersWritten = 0;
  let committedChunkCount = startedAt;

  for (let chunkIndex = startedAt; chunkIndex < limit; chunkIndex += 1) {
    const written = await commitChunk(run, chunkIndex, context.value);
    if (!written.ok) return written;

    ordersWritten += written.value;
    committedChunkCount = chunkIndex + 1;
  }

  const isFinished = committedChunkCount >= run.chunkCount;
  if (isFinished) await finishRun(staff, run.id, startedAt);

  return ok({
    committedChunkCount,
    chunkCount: run.chunkCount,
    isFinished,
    ordersWritten,
  });
}

async function commitChunk(
  run: LegacyImportRun,
  chunkIndex: number,
  context: { seasonId: string; fulfillmentMethodId: string },
): Promise<Result<number>> {
  const rows = await db.legacyImportRow.findMany({
    where: { runId: run.id, chunkIndex, status: { in: ['VALID', 'DUPLICATE'] } },
    orderBy: { lineNumber: 'asc' },
  });

  return runInTransaction(async (tx) => {
    const claimed = await tx.legacyImportRun.updateMany({
      where: { id: run.id, committedChunkCount: chunkIndex },
      data: { status: 'COMMITTING', committedChunkCount: chunkIndex + 1 },
    });

    if (claimed.count === 0) {
      abort(failure(LEGACY_SETTLED, 'Somebody else is committing this run.'));
    }

    let customersWritten = 0;
    let addressesWritten = 0;
    let orderLinesWritten = 0;
    let ordersWritten = 0;

    for (const order of groupOrders(rows, run.seasonYear)) {
      const summary = await writePriorYearOrder(tx, context, order);

      ordersWritten += 1;
      orderLinesWritten += summary.lineCount;
      addressesWritten += summary.addressesWritten;
      if (summary.customerCreated) customersWritten += 1;
    }

    await tx.legacyImportRun.update({
      where: { id: run.id },
      data: {
        ordersWritten: { increment: ordersWritten },
        orderLinesWritten: { increment: orderLinesWritten },
        customersWritten: { increment: customersWritten },
        addressesWritten: { increment: addressesWritten },
      },
    });

    return ordersWritten;
  });
}

/**
 * The reconciliation the plan asks for: what the file said the orders were
 * worth against what this database now holds for them. Recomputed from the
 * orders themselves rather than accumulated during the commit, so a chunk that
 * was written twice would show up as a difference instead of hiding in a
 * counter that was incremented twice.
 */
async function finishRun(staff: StaffContext, runId: string, resumedFromChunk: number): Promise<void> {
  const references = await db.legacyImportRow.findMany({
    where: { runId, status: { in: ['VALID', 'DUPLICATE'] } },
    select: { orderReference: true },
    distinct: ['orderReference'],
  });

  const run = await db.legacyImportRun.findUniqueOrThrow({ where: { id: runId } });
  const season = await db.season.findUnique({ where: { year: run.seasonYear } });

  // Without the season the aggregate below matches nothing and the run would
  // report a total of $0.00 against a file worth thousands — a reconciliation
  // that reads as a disaster when the truth is that the season was deleted
  // while its history was being written.
  if (!season) {
    throw new Error(
      `Season ${run.seasonYear} is gone; the orders this run wrote cannot be totalled against the file.`,
    );
  }

  const imported = await db.order.aggregate({
    where: {
      seasonId: season.id,
      importedOrderReference: {
        in: references.flatMap((row) => (row.orderReference === null ? [] : [row.orderReference])),
      },
    },
    _sum: { totalCents: true },
  });

  const finished = await db.legacyImportRun.update({
    where: { id: runId },
    data: {
      status: 'COMMITTED',
      committedAt: new Date(),
      importedTotalCents: imported._sum.totalCents ?? 0,
    },
  });

  await recordAudit(staff, {
    action: 'migration.committed',
    entityType: 'LegacyImportRun',
    entityId: runId,
    detail: {
      fileName: finished.fileName,
      seasonYear: finished.seasonYear,
      resumedFromChunk,
      ordersWritten: finished.ordersWritten,
      customersWritten: finished.customersWritten,
    },
  });
}

function groupOrders(
  rows: { orderReference: string | null; parsed: Prisma.JsonValue; mappedCustomerId: string | null }[],
  seasonYear: number,
): PriorYearOrder[] {
  const orders = new Map<string, PriorYearOrder>();

  for (const row of rows) {
    if (row.orderReference === null) continue;

    const parsed = row.parsed as unknown as LegacyParsedRow;
    const line: PriorYearLine = {
      productSlug: parsed.productSlug,
      productName: parsed.productName,
      quantity: parsed.quantity,
      unitPriceCents: parsed.unitPriceCents,
      recipientName: parsed.recipientName,
      greetingMessage: parsed.greeting,
      address: {
        line1: parsed.address.line1,
        line2: parsed.address.line2,
        city: parsed.address.city,
        state: parsed.address.state,
        postalCode: parsed.address.postalCode,
        needsReview: parsed.address.problem !== null,
        reviewNote: parsed.address.problem,
      },
    };

    const existing = orders.get(row.orderReference);
    if (existing) {
      existing.lines.push(line);
      continue;
    }

    orders.set(row.orderReference, {
      reference: row.orderReference,
      seasonYear,
      customerEmail: parsed.customerEmail,
      customerName: parsed.customerName,
      customerPhone: parsed.customerPhone,
      customerId: row.mappedCustomerId,
      placedAt: new Date(parsed.placedAt),
      lines: [line],
    });
  }

  // An order whose address book entry cannot be written is still an order: the
  // line keeps the address as text, which is what the repeat page shows.
  return [...orders.values()].filter((order) => order.lines.length > 0);
}
