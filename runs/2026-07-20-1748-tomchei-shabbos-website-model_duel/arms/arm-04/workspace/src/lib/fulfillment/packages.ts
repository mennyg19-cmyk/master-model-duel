import 'server-only';

import type { Package, PackageStage } from '@prisma/client';

import { recordAudit, type AuditActor } from '../audit';
import { failure, STALE_VERSION, type Result } from '../core/result';
import { abort, runInTransaction } from '../transaction';
import { checkPackageStage, STAGE_TIMESTAMP } from './package-stages';

export const PACKAGE_NOT_FOUND = 'package_not_found';

/**
 * Package-level status change with its own audit row, so "who marked this box
 * sent" is answerable per package rather than per order (UR-001).
 *
 * The move and its audit row commit together. A stage that advanced with no
 * trail behind it is the one thing this table exists to prevent.
 */
export async function advancePackageStage(
  input: { packageId: string; expectedVersion: number; stage: PackageStage },
  actor: AuditActor,
): Promise<Result<Package>> {
  return runInTransaction(async (tx) => {
    const current = await tx.package.findUnique({
      where: { id: input.packageId },
      include: { fulfillmentMethod: { select: { kind: true } } },
    });

    if (!current) abort(failure(PACKAGE_NOT_FOUND, 'That package no longer exists.'));

    const allowed = checkPackageStage(current.stage, input.stage, current.fulfillmentMethod.kind);
    if (!allowed.ok) abort(allowed);

    const timestampField = STAGE_TIMESTAMP[input.stage];

    const moved = await tx.package.updateMany({
      where: { id: input.packageId, version: input.expectedVersion },
      data: {
        stage: input.stage,
        version: { increment: 1 },
        ...(timestampField ? { [timestampField]: new Date() } : {}),
      },
    });

    if (moved.count === 0) {
      abort(
        failure(
          STALE_VERSION,
          'Someone else moved this package while you were looking at it. Reload and try again.',
        ),
      );
    }

    await recordAudit(
      actor,
      {
        action: 'package.stage_changed',
        entityType: 'Package',
        entityId: input.packageId,
        detail: { from: current.stage, to: input.stage },
      },
      tx,
    );

    return tx.package.findUniqueOrThrow({ where: { id: input.packageId } });
  });
}
