'use server';

import { redirect } from 'next/navigation';

import { requirePermission } from '@/lib/auth/staff';
import { redirectWithFlash } from '@/lib/forms/flash-redirect';
import { trimmedField } from '@/lib/forms/form-data';
import { commitImport, discardImport, stageImport } from '@/lib/imports/import-service';

/**
 * Two buttons, two transactions: staging writes verdicts and touches nothing
 * else, committing writes everything or nothing (R-063, R-143). The upload is
 * read here rather than in a route handler so the whole path — permission, size
 * limit, staging — stays inside one server action a form can post to.
 */
const IMPORTS_PATH = '/admin/imports';
const MAX_UPLOAD_BYTES = 2_000_000;

export async function stageImportAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('imports.manage');

  const kind = trimmedField(formData, 'kind');
  if (kind !== 'CUSTOMERS' && kind !== 'PRODUCTS') back('Choose what this file holds.');

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) back('Choose a CSV file to upload.');
  if (file.size > MAX_UPLOAD_BYTES) {
    back('That file is larger than 2 MB. Split it and upload the parts.');
  }

  const staged = await stageImport(staff, {
    kind,
    fileName: file.name,
    content: await file.text(),
    seasonId: trimmedField(formData, 'seasonId') || null,
  });

  if (!staged.ok) back(staged.publicMessage);
  redirect(previewPath(staged.value.id));
}

export async function commitImportAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('imports.manage');
  const batchId = trimmedField(formData, 'batchId');

  const committed = await commitImport(staff, batchId);
  if (!committed.ok) redirectWithFlash(previewPath(batchId), { problem: committed.publicMessage });

  const { createdCount, updatedCount } = committed.value;
  redirectWithFlash(previewPath(batchId), {
    notice: `Imported ${createdCount} new and updated ${updatedCount}.`,
  });
}

export async function discardImportAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('imports.manage');
  const batchId = trimmedField(formData, 'batchId');

  const discarded = await discardImport(staff, batchId);
  if (!discarded.ok) redirectWithFlash(previewPath(batchId), { problem: discarded.publicMessage });

  redirectWithFlash(IMPORTS_PATH, { notice: 'Import thrown away. Nothing was changed.' });
}

function previewPath(batchId: string): string {
  return `${IMPORTS_PATH}/${batchId}`;
}

function back(problem: string): never {
  redirectWithFlash(IMPORTS_PATH, { problem });
}
