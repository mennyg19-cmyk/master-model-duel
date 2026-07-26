import type { FulfillmentKind, PackageStage } from '@prisma/client';

import { failure, ok, type Result } from '../core/result';

export const ILLEGAL_STAGE = 'illegal_package_stage';

/**
 * Stages are optional (UR-001, G-001): an org that only prints packing slips
 * never advances past PRINTED, and a package may skip straight from NEW to
 * PACKED. What it may never do is move backwards, and printing a label must
 * never imply the box left the building — PRINTED and SENT are separate ranks
 * for exactly that reason (G-004).
 *
 * SENT and PICKED_UP share a rank because they are two different endings, not
 * two steps: a shipped package is never later picked up.
 */
const STAGE_RANK: Record<PackageStage, number> = {
  NEW: 0,
  PRINTED: 1,
  PACKED: 2,
  SENT: 3,
  PICKED_UP: 3,
};

export const STAGE_TIMESTAMP: Record<
  PackageStage,
  'printedAt' | 'packedAt' | 'sentAt' | 'pickedUpAt' | null
> = {
  NEW: null,
  PRINTED: 'printedAt',
  PACKED: 'packedAt',
  SENT: 'sentAt',
  PICKED_UP: 'pickedUpAt',
};

export function checkPackageStage(
  from: PackageStage,
  to: PackageStage,
  methodKind: FulfillmentKind,
): Result<null> {
  if (STAGE_RANK[to] <= STAGE_RANK[from]) {
    return failure(ILLEGAL_STAGE, `A package at ${from} cannot go back to ${to}.`);
  }

  if (methodKind === 'PICKUP' && to === 'SENT') {
    return failure(ILLEGAL_STAGE, 'A pickup package is collected, not sent.');
  }

  if (methodKind !== 'PICKUP' && to === 'PICKED_UP') {
    return failure(ILLEGAL_STAGE, 'Only a pickup package can be marked picked up.');
  }

  return ok(null);
}
