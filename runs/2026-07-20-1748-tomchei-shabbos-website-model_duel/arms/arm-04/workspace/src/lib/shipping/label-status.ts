import type { PackageStage, ShippingLabelStatus } from '@prisma/client';

/**
 * When a label counts, in the three senses the rest of the code asks about.
 *
 * They live together because they are one rule read from three sides, and the
 * board used to answer the third by comparing against `'PURCHASED'` itself —
 * which is the copy that goes stale the day a fourth status appears.
 */

/** Stages a label may still be cancelled in: printed paper is not a shipped box (G-004). */
const VOIDABLE_STAGES: PackageStage[] = ['NEW', 'PRINTED', 'PACKED'];

/** A box with one of these already has carriage: buying again would pay twice. */
export const ACTIVE_LABEL_STATUSES: ShippingLabelStatus[] = ['PENDING', 'PURCHASED'];

/** Whether the board should offer to cancel this box's carriage. */
export function isLabelVoidable(stage: PackageStage): boolean {
  return VOIDABLE_STAGES.includes(stage);
}

/** Claimed or bought — either way this parcel is somebody's carriage already. */
export function isActiveLabel(status: ShippingLabelStatus): boolean {
  return ACTIVE_LABEL_STATUSES.includes(status);
}

/** Bought and live at the carrier, so there is a label to track, cancel or print. */
export function isLabelBought(status: ShippingLabelStatus): boolean {
  return status === 'PURCHASED';
}
