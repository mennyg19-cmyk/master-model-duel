'use server';

import { revalidatePath } from 'next/cache';

import { requirePermission } from '@/lib/auth/staff';
import { setReplacementLink } from '@/lib/catalog/admin';
import { redirectWithFlash } from '@/lib/forms/flash-redirect';
import { trimmedField } from '@/lib/forms/form-data';

const PATH = '/admin/catalog/replacements';

/**
 * One row of the mappings table saved (R-048).
 *
 * The table posts a whole row rather than the page: a manager fixing one box
 * should not be able to overwrite twenty other rows that somebody else changed
 * while the page was open.
 */
export async function setMappingAction(formData: FormData): Promise<void> {
  const context = await requirePermission('catalog.manage');
  const from = trimmedField(formData, 'from');
  const replacedByProductId = trimmedField(formData, 'replacedByProductId');

  const linked = await setReplacementLink(context, {
    productId: trimmedField(formData, 'productId'),
    replacedByProductId: replacedByProductId === '' ? null : replacedByProductId,
  });
  if (!linked.ok) back(from, linked.publicMessage);

  done(
    from,
    replacedByProductId === ''
      ? 'Mapping cleared. Repeat orders will ask about that item instead.'
      : 'Mapping saved.',
  );
}

function done(from: string, notice: string): never {
  revalidatePath(PATH);
  redirectWithFlash(PATH, { from, notice });
}

function back(from: string, problem: string): never {
  redirectWithFlash(PATH, { from, problem });
}
