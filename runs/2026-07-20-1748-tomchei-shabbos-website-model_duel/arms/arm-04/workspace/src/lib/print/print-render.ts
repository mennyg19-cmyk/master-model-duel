import 'server-only';

import { recordAudit, type AuditActor } from '../audit';
import { failure, ok, type Result } from '../core/result';
import { db } from '../db';
import { ARTIFACT_LABELS, renderArtifact, type PrintArtifact } from './documents';
import { filingSortKey } from './filing-groups';
import { fileNameFor, NOTHING_TO_PRINT, PRINT_GROUP_NOT_FOUND, readInFilingOrder } from './print-filing';
import { printableOrderWhere, readPrintablePackages } from './print-data';

/**
 * Paper coming out of the machine (UR-005, R-056).
 *
 * Rendering changes no package. The audit row says paper was produced, and that
 * is the only trace printing is allowed to leave (G-002, G-004).
 */
export type PrintedDocument = { fileName: string; bytes: Buffer };

/**
 * The PDF for one artifact of one filing group, rendered from the membership
 * the batch recorded rather than from what the data looks like now.
 */
export async function renderGroupArtifact(
  actor: AuditActor,
  input: { batchId: string; groupId: string; seasonId: string; artifact: PrintArtifact },
): Promise<Result<PrintedDocument>> {
  const group = await db.printBatchGroup.findFirst({
    where: { id: input.groupId, batchId: input.batchId, batch: { seasonId: input.seasonId } },
    include: { batch: { select: { label: true } }, items: { orderBy: { sortKey: 'asc' } } },
  });

  if (!group) {
    return failure(PRINT_GROUP_NOT_FOUND, 'That filing group is no longer on this batch.');
  }

  const filed = await readInFilingOrder(group.items);
  const heading = `${group.batch.label} · ${group.label}`;

  await recordAudit(actor, {
    action: 'print.rendered',
    entityType: 'PrintBatchGroup',
    entityId: group.id,
    detail: { artifact: input.artifact, scope: 'group', packageCount: filed.length },
  });

  return ok({
    fileName: fileNameFor(`${group.label}-${ARTIFACT_LABELS[input.artifact]}`),
    bytes: renderArtifact(input.artifact, heading, filed),
  });
}

/** One order's own paper, straight off the order screen (R-056). */
export async function renderOrderArtifact(
  actor: AuditActor,
  input: { orderId: string; seasonId: string; artifact: PrintArtifact },
): Promise<Result<PrintedDocument>> {
  const boxes = await readPrintablePackages({
    orderId: input.orderId,
    order: printableOrderWhere(input.seasonId),
  });

  if (boxes.length === 0) {
    return failure(
      NOTHING_TO_PRINT,
      'There is no paper to print for this order: it has not been packed into boxes, or it is cancelled, finished, or from another season.',
    );
  }

  const sorted = [...boxes].sort((left, right) =>
    filingSortKey(left).localeCompare(filingSortKey(right)),
  );
  const first = sorted[0];
  const heading =
    first.orderNumber === null ? first.draftReference : `Order #${first.orderNumber}`;

  await recordAudit(actor, {
    action: 'print.rendered',
    entityType: 'Order',
    entityId: input.orderId,
    detail: { artifact: input.artifact, scope: 'order', packageCount: sorted.length },
  });

  return ok({
    fileName: fileNameFor(`${heading}-${ARTIFACT_LABELS[input.artifact]}`),
    bytes: renderArtifact(input.artifact, heading, sorted),
  });
}
