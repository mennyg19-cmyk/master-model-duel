import 'server-only';

import { randomUUID } from 'node:crypto';

import type { PackageStage } from '@prisma/client';

import {
  boundedIds,
  bulkReport,
  type BulkRecord,
  type BulkReport,
} from '../admin/bulk-report';
import type { StaffContext } from '../auth/staff';
import { STALE_VERSION } from '../core/result';
import { db } from '../db';
import { boardScopeWhere } from './channel-summary';
import { advancePackageStage } from './packages';

/**
 * The packing table's sweep: tick a screen full of boxes, mark them all packed
 * (UR-001, G-024).
 *
 * Each box still goes through `advancePackageStage`, so a sweep can do nothing
 * a single box could not: the same rank rule, the same pickup-versus-shipping
 * rule, the same audit row. What the sweep adds is a batch id on all of them and
 * a report of what it could not do — a box a colleague already marked sent comes
 * back as skipped, not as an error that stops the other ninety-nine.
 *
 * Versions are read here rather than taken from the form. The form's job is to
 * say which boxes; a sweep of a hundred rows drawn a minute ago would otherwise
 * be one stale row away from reporting a conflict on every one of them.
 */
export async function bulkAdvanceStage(
  staff: StaffContext,
  input: { seasonId: string; packageIds: string[]; stage: PackageStage },
): Promise<BulkReport> {
  const { seasonId, stage } = input;
  const batchId = randomUUID();
  const { ids, droppedCount } = boundedIds(input.packageIds);

  const boxes = await db.package.findMany({
    where: { id: { in: ids }, ...boardScopeWhere(seasonId) },
    select: { id: true, version: true, stage: true, recipientName: true },
  });
  const byId = new Map(boxes.map((box) => [box.id, box]));
  const records: BulkRecord[] = [];

  for (const id of ids) {
    const box = byId.get(id);
    if (!box) {
      records.push({
        id,
        label: `~${id.slice(0, 8)}`,
        outcome: 'skipped',
        detail: 'No longer on the board for this season.',
      });
      continue;
    }

    const moved = await advancePackageStage(
      { packageId: id, seasonId, expectedVersion: box.version, stage, batchId },
      staff,
    );

    records.push({
      id,
      label: box.recipientName,
      outcome: moved.ok ? 'applied' : moved.code === STALE_VERSION ? 'conflict' : 'skipped',
      detail: moved.ok ? `${box.stage} → ${stage}` : moved.publicMessage,
    });
  }

  return bulkReport(batchId, `stage:${stage}`, records, droppedCount);
}
