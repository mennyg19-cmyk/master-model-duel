import 'server-only';

import type { PrintBatchKind, Prisma } from '@prisma/client';

import { recordAudit, type AuditActor } from '../audit';
import { ORG_TIME_ZONE } from '../core/dates';
import { failure, type Result } from '../core/result';
import { db } from '../db';
import { abort, runInTransaction } from '../transaction';
import { groupCreateInput, NOT_PRINTABLE, NOTHING_TO_PRINT, PRINT_GROUP_NOT_FOUND } from './print-filing';
import { printableOrderWhere, readPrintablePackages } from './print-data';

/**
 * Tonight's batch and the reprints of it (UR-005).
 *
 * The batch stores which boxes belong in which filing group and nothing else.
 * The PDFs are rendered from that membership on demand, which is what makes a
 * reprint the same paper as the original rather than a fresh document built
 * from whatever the data looks like tonight.
 *
 * Running the job twice is harmless: a box with a nightly row already against it
 * is not picked up again, and the whole build runs under an advisory lock so two
 * runs that overlap queue instead of both claiming the same boxes.
 */
export const NIGHTLY_PRINT_JOB = 'print.nightly-batch';

export type NightlyBatchSummary = {
  batchId: string | null;
  label: string;
  packageCount: number;
  groupCount: number;
};

/**
 * Boxes that have never been on a nightly batch, on orders that are being
 * worked.
 *
 * The "no nightly row yet" clause is the whole of the idempotency rule: it is
 * what a second run of the job reads, and what makes it find nothing.
 */
function waitingToPrintWhere(seasonId: string): Prisma.PackageWhereInput {
  return {
    order: printableOrderWhere(seasonId),
    printItems: { none: { group: { batch: { kind: 'NIGHTLY' } } } },
  };
}

export async function buildNightlyBatch(
  actor: AuditActor,
  input: { seasonId: string; now?: Date },
): Promise<Result<NightlyBatchSummary>> {
  const now = input.now ?? new Date();
  const label = `Tonight's batch — ${new Intl.DateTimeFormat('en-US', {
    timeZone: ORG_TIME_ZONE,
    dateStyle: 'medium',
  }).format(now)}`;
  const run = await db.cronRunLog.create({ data: { jobName: NIGHTLY_PRINT_JOB } });

  try {
    const built = await runInTransaction(async (tx) => {
      // Held until this transaction ends. Two runs that overlap queue instead of
      // both reading the same unprinted boxes and filing each of them twice.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${NIGHTLY_PRINT_JOB}))`;

      const waiting = await readPrintablePackages(waitingToPrintWhere(input.seasonId), tx);

      if (waiting.length === 0) {
        return { batchId: null, label, packageCount: 0, groupCount: 0 };
      }

      const batch = await tx.printBatch.create({
        data: {
          seasonId: input.seasonId,
          kind: 'NIGHTLY',
          label,
          packageCount: waiting.length,
          createdByStaffUserId: actor?.actor.id ?? null,
          groups: { create: groupCreateInput(waiting) },
        },
        include: { groups: true },
      });

      await recordAudit(
        actor,
        {
          action: 'print.batch_created',
          entityType: 'PrintBatch',
          entityId: batch.id,
          detail: { kind: 'NIGHTLY', packageCount: waiting.length, groupCount: batch.groups.length },
        },
        tx,
      );

      return {
        batchId: batch.id,
        label,
        packageCount: waiting.length,
        groupCount: batch.groups.length,
      };
    });

    await db.cronRunLog.update({
      where: { id: run.id },
      data: {
        status: built.ok ? 'SUCCEEDED' : 'FAILED',
        finishedAt: new Date(),
        itemsProcessed: built.ok ? built.value.packageCount : 0,
        detail: built.ok
          ? { batchId: built.value.batchId, groups: built.value.groupCount }
          : { code: built.code },
      },
    });

    return built;
  } catch (error) {
    await db.cronRunLog.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        detail: { message: error instanceof Error ? error.message : 'unknown error' },
      },
    });

    throw error;
  }
}

/**
 * Reprints the paper for one filing group (UR-005).
 *
 * A new batch that points back at the one it came from, rather than an edit of
 * the original: the pile already on the table came from that batch, and the
 * record of what was on it has to survive somebody pressing reprint. Nothing
 * about the other groups is read or touched.
 */
export function reprintGroup(
  actor: AuditActor,
  input: { batchId: string; groupId: string; seasonId: string },
): Promise<Result<{ batchId: string; label: string; packageCount: number }>> {
  return runInTransaction(async (tx) => {
    const group = await tx.printBatchGroup.findFirst({
      where: { id: input.groupId, batchId: input.batchId, batch: { seasonId: input.seasonId } },
      include: { items: true },
    });

    if (!group) abort(failure(PRINT_GROUP_NOT_FOUND, 'That filing group is no longer on this batch.'));

    const reprint = await tx.printBatch.create({
      data: {
        seasonId: input.seasonId,
        kind: 'REPRINT',
        label: `Reprint — ${group.label}`,
        packageCount: group.items.length,
        createdByStaffUserId: actor?.actor.id ?? null,
        supersedesBatchId: input.batchId,
        groups: {
          create: {
            filingKey: group.filingKey,
            label: group.label,
            sortIndex: 0,
            packageCount: group.items.length,
            items: {
              create: group.items.map((filing) => ({
                packageId: filing.packageId,
                orderId: filing.orderId,
                sortKey: filing.sortKey,
              })),
            },
          },
        },
      },
    });

    await recordAudit(
      actor,
      {
        action: 'print.batch_created',
        entityType: 'PrintBatch',
        entityId: reprint.id,
        detail: {
          kind: 'REPRINT',
          packageCount: group.items.length,
          groupCount: 1,
          supersedesBatchId: input.batchId,
        },
      },
      tx,
    );

    return { batchId: reprint.id, label: reprint.label, packageCount: group.items.length };
  });
}

/**
 * Reprints one order's boxes, filed the same way the nightly batch files them —
 * and refused for the same orders the nightly batch refuses.
 */
export function reprintOrder(
  actor: AuditActor,
  input: { orderId: string; seasonId: string },
): Promise<Result<{ batchId: string; label: string; packageCount: number }>> {
  return runInTransaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: input.orderId, ...printableOrderWhere(input.seasonId) },
      select: { orderNumber: true, draftReference: true },
    });

    if (!order) {
      abort(
        failure(
          NOT_PRINTABLE,
          'Paper is only filed for placed and in-fulfillment orders in the current season. This order is cancelled, finished, or from another season.',
        ),
      );
    }

    const boxes = await readPrintablePackages({ orderId: input.orderId }, tx);
    if (boxes.length === 0) {
      abort(failure(NOTHING_TO_PRINT, 'This order has not been packed into boxes yet.'));
    }

    const label = `Reprint — ${
      order.orderNumber === null ? order.draftReference : `order #${order.orderNumber}`
    }`;
    const supersedesBatchId = await lastFilingOf(tx, boxes.map((box) => box.id));

    const reprint = await tx.printBatch.create({
      data: {
        seasonId: input.seasonId,
        kind: 'REPRINT',
        label,
        packageCount: boxes.length,
        createdByStaffUserId: actor?.actor.id ?? null,
        supersedesBatchId,
        groups: { create: groupCreateInput(boxes) },
      },
      include: { groups: true },
    });

    await recordAudit(
      actor,
      {
        action: 'print.batch_created',
        entityType: 'PrintBatch',
        entityId: reprint.id,
        detail: {
          kind: 'REPRINT',
          packageCount: boxes.length,
          groupCount: reprint.groups.length,
          supersedesBatchId,
        },
      },
      tx,
    );

    return { batchId: reprint.id, label, packageCount: boxes.length };
  });
}

/**
 * The batch these boxes were last filed on. A reprint says which pile it
 * replaces (`supersedesBatchId`), and for an order that means the most recent
 * batch any of its boxes was on — null while it has never been filed at all.
 */
async function lastFilingOf(
  tx: Prisma.TransactionClient,
  packageIds: string[],
): Promise<string | null> {
  const filing = await tx.printBatchGroup.findFirst({
    where: { items: { some: { packageId: { in: packageIds } } } },
    orderBy: { batch: { createdAt: 'desc' } },
    select: { batchId: true },
  });

  return filing?.batchId ?? null;
}

export type BatchGroupRow = {
  id: string;
  label: string;
  filingKey: string;
  packageCount: number;
};

export type BatchRow = {
  id: string;
  label: string;
  kind: PrintBatchKind;
  packageCount: number;
  createdAt: Date;
  createdBy: string | null;
  groups: BatchGroupRow[];
};

export async function readBatch(seasonId: string, batchId: string): Promise<BatchRow | null> {
  const batch = await db.printBatch.findFirst({
    where: { id: batchId, seasonId },
    include: {
      createdBy: { select: { fullName: true } },
      groups: { orderBy: { sortIndex: 'asc' } },
    },
  });

  return batch === null ? null : toBatchRow(batch);
}

export async function listRecentBatches(seasonId: string, take = 8): Promise<BatchRow[]> {
  const batches = await db.printBatch.findMany({
    where: { seasonId },
    include: {
      createdBy: { select: { fullName: true } },
      groups: { orderBy: { sortIndex: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
    take,
  });

  return batches.map(toBatchRow);
}

/** How many boxes are waiting for their first nightly batch. */
export function countWaitingToPrint(seasonId: string): Promise<number> {
  return db.package.count({ where: waitingToPrintWhere(seasonId) });
}

type BatchWithGroups = Prisma.PrintBatchGetPayload<{
  include: { createdBy: { select: { fullName: true } }; groups: true };
}>;

function toBatchRow(batch: BatchWithGroups): BatchRow {
  return {
    id: batch.id,
    label: batch.label,
    kind: batch.kind,
    packageCount: batch.packageCount,
    createdAt: batch.createdAt,
    createdBy: batch.createdBy?.fullName ?? null,
    groups: batch.groups.map((group) => ({
      id: group.id,
      label: group.label,
      filingKey: group.filingKey,
      packageCount: group.packageCount,
    })),
  };
}
