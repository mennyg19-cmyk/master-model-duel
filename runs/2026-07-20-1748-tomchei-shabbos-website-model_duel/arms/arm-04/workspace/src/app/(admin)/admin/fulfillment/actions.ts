'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { readActiveSeason } from '@/lib/admin/dashboard';
import { firstFewOutcomes, summarizeBulk } from '@/lib/admin/bulk-report';
import { recordAudit } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/staff';
import { formatCents } from '@/lib/core/money';
import { db } from '@/lib/db';
import { redirectWithFlash } from '@/lib/forms/flash-redirect';
import { readVersionStamp, trimmedField } from '@/lib/forms/form-data';
import { bulkAdvanceStage } from '@/lib/fulfillment/bulk-stages';
import { movePackageLines, splitPackage } from '@/lib/fulfillment/package-edit';
import { advancePackageStage } from '@/lib/fulfillment/packages';
import { batchPath, BOARD_PATH, FULFILLMENT_PATH, packagePath } from '@/lib/print/paths';
import { buildNightlyBatch, reprintGroup, reprintOrder } from '@/lib/print/print-batch-service';
import { validatePackageAddress } from '@/lib/shipping/address-check';
import {
  buyLabelForPackage,
  refreshTrackingForPackage,
  voidLabelForPackage,
} from '@/lib/shipping/label-service';

/**
 * Everything the packing table can press (UR-001, UR-005, G-003).
 *
 * All of it sits behind `fulfillment.manage`, which is a separate permission
 * from `orders.manage` on purpose: the volunteers who pack boxes on Purim night
 * should be able to move a box to Packed without being able to refund a card.
 *
 * Every action names the season it is working. Ids arrive from forms, and a box
 * or a batch from another season is not something this screen may touch.
 */
const stageSchema = z.enum(['PRINTED', 'PACKED', 'SENT', 'PICKED_UP']);
const intentSchema = z.enum(['move', 'split']);
const STALE_SCREEN = 'This screen is out of date. Reload the box and try again.';

/** A sentence explaining a cancelled label, not a place to paste a thread into. */
const MAX_VOID_REASON_LENGTH = 500;

export async function buildBatchAction(): Promise<void> {
  const staff = await requirePermission('fulfillment.manage');
  const seasonId = await workingSeasonId();

  const built = await buildNightlyBatch(staff, { seasonId });
  if (!built.ok) backToHub(built.publicMessage);

  const summary = built.value;
  revalidatePath(FULFILLMENT_PATH);

  if (summary.batchId === null) {
    doneAtHub('Every box has already been on a batch. Nothing new to print.');
  }

  redirectWithFlash(batchPath(summary.batchId), {
    notice: `${summary.packageCount} box${summary.packageCount === 1 ? '' : 'es'} filed into ${summary.groupCount} group${summary.groupCount === 1 ? '' : 's'}.`,
  });
}

export async function reprintGroupAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('fulfillment.manage');
  const batchId = trimmedField(formData, 'batchId');
  const seasonId = await workingSeasonId();

  const reprinted = await reprintGroup(staff, {
    batchId,
    groupId: trimmedField(formData, 'groupId'),
    seasonId,
  });

  if (!reprinted.ok) {
    redirectWithFlash(batchPath(batchId), { problem: reprinted.publicMessage });
  }

  redirectWithFlash(batchPath(reprinted.value.batchId), {
    notice: `Reprint ready. The original batch is untouched.`,
  });
}

export async function reprintOrderAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('fulfillment.manage');
  const orderId = trimmedField(formData, 'orderId');
  const seasonId = await workingSeasonId();

  const reprinted = await reprintOrder(staff, { orderId, seasonId });
  if (!reprinted.ok) {
    redirectWithFlash(`/admin/orders/${orderId}`, { problem: reprinted.publicMessage });
  }

  redirectWithFlash(batchPath(reprinted.value.batchId), {
    notice: `${reprinted.value.packageCount} box${reprinted.value.packageCount === 1 ? '' : 'es'} ready to print again.`,
  });
}

export async function advanceStageAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('fulfillment.manage');
  const packageId = trimmedField(formData, 'packageId');

  const stage = stageSchema.safeParse(trimmedField(formData, 'stage'));
  if (!stage.success) backToPackage(packageId, 'That is not a stage a box can be moved to.');

  const expectedVersion = readVersionStamp(formData);
  if (expectedVersion === null) backToPackage(packageId, STALE_SCREEN);

  const seasonId = await workingSeasonId();

  const moved = await advancePackageStage(
    { packageId, seasonId, expectedVersion, stage: stage.data },
    staff,
  );

  if (!moved.ok) backToPackage(packageId, moved.publicMessage);
  doneAtPackage(packageId, `Marked ${stage.data.toLowerCase().replace('_', ' ')}.`);
}

/**
 * The sweep from the board. Its report goes on the URL and its batch goes in the
 * audit trail, exactly as the order desk's does — two people sweeping the same
 * screen have to be able to see whose move landed.
 */
export async function bulkStageAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('fulfillment.manage');
  const returnTo = trimmedField(formData, 'returnTo');
  const packageIds = formData.getAll('packageIds').map(String);

  if (packageIds.length === 0) backToBoard(returnTo, 'Tick the boxes you want to move first.');

  const stage = stageSchema.safeParse(trimmedField(formData, 'stage'));
  if (!stage.success) backToBoard(returnTo, 'That is not a stage a box can be moved to.');

  const seasonId = await workingSeasonId();
  const report = await bulkAdvanceStage(staff, { seasonId, packageIds, stage: stage.data });

  await recordAudit(staff, {
    action: 'packages.bulk_stage',
    entityType: 'Package',
    entityId: report.batchId,
    detail: {
      batchId: report.batchId,
      stage: stage.data,
      applied: report.applied,
      skipped: report.skipped,
      conflicts: report.conflicts,
      droppedCount: report.droppedCount,
    },
  });

  revalidatePath(BOARD_PATH);
  doneAtBoard(returnTo, `${summarizeBulk(report)} — ${firstFewOutcomes(report)}`);
}

/**
 * Splitting and regrouping are one action because they are one form: staff tick
 * the items once and then say where they should go. Which button they pressed
 * arrives as `intent`, the way a submit button's name and value always has —
 * this screen has to keep working with JavaScript off.
 */
export async function editPackageAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('fulfillment.manage');
  const packageId = trimmedField(formData, 'packageId');
  const lineIds = formData.getAll('lineIds').map(String);

  const intent = intentSchema.safeParse(trimmedField(formData, 'intent'));
  if (!intent.success) backToPackage(packageId, 'That is not something this form can do to a box.');

  const expectedVersion = readVersionStamp(formData);
  if (expectedVersion === null) backToPackage(packageId, STALE_SCREEN);

  if (intent.data === 'move') {
    const toPackageId = trimmedField(formData, 'toPackageId');

    const moved = await movePackageLines(
      { fromPackageId: packageId, toPackageId, expectedVersion, lineIds },
      staff,
    );

    if (!moved.ok) backToPackage(packageId, moved.publicMessage);

    revalidatePath(BOARD_PATH);
    doneAtPackage(
      toPackageId,
      moved.value.sourceRemoved
        ? 'Moved. The box it came from was empty, so it is gone.'
        : `Moved ${moved.value.movedCount} item${moved.value.movedCount === 1 ? '' : 's'} into this box.`,
    );
  }

  const split = await splitPackage({ packageId, expectedVersion, lineIds }, staff);
  if (!split.ok) backToPackage(packageId, split.publicMessage);

  revalidatePath(packagePath(packageId));
  doneAtPackage(split.value.id, 'Split into a second box. The fee stayed on the first.');
}

/**
 * Buying carriage (UR-003). This is the only button on the packing table that
 * spends money, so it says what it spent and on whose rate.
 */
export async function buyLabelAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('fulfillment.manage');
  const packageId = trimmedField(formData, 'packageId');
  const seasonId = await workingSeasonId();

  const bought = await buyLabelForPackage(db, staff, { packageId, seasonId });
  if (!bought.ok) backToPackage(packageId, bought.publicMessage);

  const label = bought.value;

  doneAtPackage(
    packageId,
    `${label.carrier} ${label.serviceLabel} bought for ${label.parcelCount} parcel${label.parcelCount === 1 ? '' : 's'}: ` +
      `${formatCents(label.carrierCostCents)} paid, ${formatCents(label.customerPriceCents)} charged, ` +
      `${formatCents(label.marginCents)} to the campaign.`,
  );
}

/**
 * Cancelling carriage (R-055, UR-004). The reason is required because this row
 * is the only explanation a reconciler will ever have for a refunded label.
 */
export async function voidLabelAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('fulfillment.manage');
  const packageId = trimmedField(formData, 'packageId');
  const reason = trimmedField(formData, 'reason');

  if (reason === '') backToPackage(packageId, 'Say why the label is being cancelled first.');

  if (reason.length > MAX_VOID_REASON_LENGTH) {
    backToPackage(packageId, `Keep the reason under ${MAX_VOID_REASON_LENGTH} characters.`);
  }

  const seasonId = await workingSeasonId();
  const voided = await voidLabelForPackage(db, staff, { packageId, seasonId, reason });
  if (!voided.ok) backToPackage(packageId, voided.publicMessage);

  doneAtPackage(packageId, `${voided.value.carrier} label cancelled. ${voided.value.note}`);
}

export async function refreshTrackingAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('fulfillment.manage');
  const packageId = trimmedField(formData, 'packageId');
  const seasonId = await workingSeasonId();

  const refreshed = await refreshTrackingForPackage(db, staff, { packageId, seasonId });
  if (!refreshed.ok) backToPackage(packageId, refreshed.publicMessage);

  doneAtPackage(packageId, `The carrier reports: ${refreshed.value.status}.`);
}

/** Advisory (R-177): a carrier that cannot match an address is often simply wrong. */
export async function validateAddressAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('fulfillment.manage');
  const packageId = trimmedField(formData, 'packageId');
  const seasonId = await workingSeasonId();

  const checked = await validatePackageAddress(db, staff, { packageId, seasonId });
  if (!checked.ok) backToPackage(packageId, checked.publicMessage);

  doneAtPackage(packageId, checked.value.note);
}

/** Every screen here works one season; without one there is nothing to pack. */
async function workingSeasonId(): Promise<string> {
  const season = await readActiveSeason();
  if (!season) backToHub('There is no season to work on yet.');

  return season.id;
}

/** The board's own filters, so a redirect cannot smuggle anything else back. */
const BOARD_FILTERS = ['q', 'stage', 'channel', 'size', 'page'] as const;

function boardFilters(returnTo: string): Record<string, string> {
  const posted = new URLSearchParams(returnTo);
  const kept: Record<string, string> = {};

  for (const name of BOARD_FILTERS) {
    const value = posted.get(name);
    if (value) kept[name] = value;
  }

  return kept;
}

function doneAtBoard(returnTo: string, notice: string): never {
  redirectWithFlash(BOARD_PATH, { ...boardFilters(returnTo), notice });
}

function backToBoard(returnTo: string, problem: string): never {
  redirectWithFlash(BOARD_PATH, { ...boardFilters(returnTo), problem });
}

function doneAtPackage(packageId: string, notice: string): never {
  revalidatePath(packagePath(packageId));
  redirectWithFlash(packagePath(packageId), { notice });
}

function backToPackage(packageId: string, problem: string): never {
  redirectWithFlash(packagePath(packageId), { problem });
}

function doneAtHub(notice: string): never {
  redirectWithFlash(FULFILLMENT_PATH, { notice });
}

function backToHub(problem: string): never {
  redirectWithFlash(FULFILLMENT_PATH, { problem });
}
