'use server';

import { redirect } from 'next/navigation';

import { requirePermission } from '@/lib/auth/staff';
import { redirectWithFlash, rejectWith } from '@/lib/forms/flash-redirect';
import { trimmedField } from '@/lib/forms/form-data';
import { resolveCleanupFlag, scanAddressBook } from '@/lib/migration/address-cleanup';
import { commitLegacyImport } from '@/lib/migration/legacy-commit';
import {
  discardLegacyImport,
  dryRunLegacyImport,
  mapLegacyRow,
} from '@/lib/migration/legacy-import';

/**
 * The buttons on the migration screens (R-186, G-029, UR-014).
 *
 * Uploading only ever produces a dry run. Committing is a separate press, and
 * it is a press that may have to be made more than once: the commit works
 * through a bounded number of chunks and comes back saying where it got to,
 * rather than holding one request open over a decade of orders.
 */
const MIGRATION_PATH = '/admin/migration';
const CLEANUP_PATH = '/admin/migration/cleanup';
const MAX_UPLOAD_BYTES = 8_000_000;

export async function dryRunLegacyImportAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('migration.manage');

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) rejectWith(MIGRATION_PATH, 'Choose a CSV file.');
  if (file.size > MAX_UPLOAD_BYTES) {
    rejectWith(MIGRATION_PATH, 'That file is larger than 8 MB. Split it and upload the parts.');
  }

  const seasonYear = Number(trimmedField(formData, 'seasonYear'));
  if (!Number.isInteger(seasonYear)) rejectWith(MIGRATION_PATH, 'Choose which season this history is.');

  const staged = await dryRunLegacyImport(staff, {
    fileName: file.name,
    content: await file.text(),
    seasonYear,
  });

  if (!staged.ok) rejectWith(MIGRATION_PATH, staged.publicMessage);
  redirect(runPath(staged.value.id));
}

export async function commitLegacyImportAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('migration.manage');
  const runId = trimmedField(formData, 'runId');

  const committed = await commitLegacyImport(staff, runId);
  if (!committed.ok) rejectWith(runPath(runId), committed.publicMessage);

  const { committedChunkCount, chunkCount, isFinished, ordersWritten } = committed.value;

  redirectWithFlash(runPath(runId), {
    notice: isFinished
      ? `Imported. ${ordersWritten} more orders written; the run is complete.`
      : `${ordersWritten} orders written. ${committedChunkCount} of ${chunkCount} batches done — press Continue for the rest.`,
  });
}

export async function mapLegacyRowAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('migration.manage');
  const runId = trimmedField(formData, 'runId');

  const lineNumber = Number(trimmedField(formData, 'lineNumber'));
  if (!Number.isInteger(lineNumber)) rejectWith(runPath(runId), 'That is not a line in this file.');

  const mapped = await mapLegacyRow(staff, {
    runId,
    lineNumber,
    customerId: trimmedField(formData, 'customerId'),
  });

  if (!mapped.ok) rejectWith(runPath(runId), mapped.publicMessage);
  redirectWithFlash(runPath(runId), { notice: 'Line matched.' });
}

export async function discardLegacyImportAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('migration.manage');
  const runId = trimmedField(formData, 'runId');

  const discarded = await discardLegacyImport(staff, runId);
  if (!discarded.ok) rejectWith(runPath(runId), discarded.publicMessage);

  redirectWithFlash(MIGRATION_PATH, { notice: 'Dry run thrown away. Nothing was written.' });
}

export async function scanAddressBookAction(): Promise<void> {
  const staff = await requirePermission('migration.manage');
  const summary = await scanAddressBook(staff);

  redirectWithFlash(CLEANUP_PATH, {
    notice: `${summary.openCount} to look at: ${summary.flagged} new, ${summary.reopened} reopened, ${summary.cleared} already fixed.`,
  });
}

export async function resolveCleanupFlagAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('migration.manage');
  const decision = trimmedField(formData, 'decision');

  if (decision !== 'MERGED' && decision !== 'KEPT') rejectWith(CLEANUP_PATH, 'Choose merge or keep.');

  const resolved = await resolveCleanupFlag(staff, {
    flagId: trimmedField(formData, 'flagId'),
    decision,
  });

  if (!resolved.ok) rejectWith(CLEANUP_PATH, resolved.publicMessage);

  redirectWithFlash(CLEANUP_PATH, {
    notice: decision === 'MERGED' ? 'Merged.' : 'Left as it is.',
  });
}

function runPath(runId: string): string {
  return `${MIGRATION_PATH}/${runId}`;
}
