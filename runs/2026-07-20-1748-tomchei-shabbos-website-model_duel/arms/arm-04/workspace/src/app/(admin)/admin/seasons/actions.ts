'use server';

import { revalidatePath } from 'next/cache';

import { requirePermission } from '@/lib/auth/staff';
import { redirectWithFlash } from '@/lib/forms/flash-redirect';
import { trimmedField } from '@/lib/forms/form-data';
import { setSeasonStatus } from '@/lib/seasons/management';
import { setSeasonSchedule } from '@/lib/seasons/schedule';
import { createSeasonFromWizard } from '@/lib/seasons/wizard';

/**
 * The season calendar's actions (UR-008, R-097).
 *
 * All three are manager work — `seasons.manage` is not in the office role — and
 * all three land back on the calendar with one line about what happened, which
 * is the same shape every other admin screen uses.
 */
const SEASONS_PATH = '/admin/seasons';
const WIZARD_PATH = '/admin/seasons/new';

export async function setSeasonStatusAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('seasons.manage');
  const to = trimmedField(formData, 'to');
  if (to !== 'OPEN' && to !== 'CLOSED') back(`A season is either open or closed, not "${to}".`);

  const flipped = await setSeasonStatus(staff, {
    seasonId: trimmedField(formData, 'seasonId'),
    to,
  });
  if (!flipped.ok) back(flipped.publicMessage);

  revalidatePath('/', 'layout');
  done(
    to === 'OPEN'
      ? `${flipped.value.label} is open. The storefront is taking orders.`
      : `${flipped.value.label} is closed. Browsing and the archive stay open.`,
  );
}

export async function setSeasonScheduleAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('seasons.manage');

  const saved = await setSeasonSchedule(staff, {
    seasonId: trimmedField(formData, 'seasonId'),
    opensAt: trimmedField(formData, 'opensAt'),
    closesAt: trimmedField(formData, 'closesAt'),
  });
  if (!saved.ok) back(saved.publicMessage);

  done(`Schedule saved for ${saved.value.label}.`);
}

export async function createSeasonAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('seasons.manage');

  const created = await createSeasonFromWizard(staff, {
    year: trimmedField(formData, 'year'),
    label: trimmedField(formData, 'label'),
    copyFromSeasonId: trimmedField(formData, 'copyFromSeasonId'),
    productIds: formData.getAll('productIds').map(String),
    copyAddOns: formData.get('copyAddOns') === 'on',
    linkReplacements: formData.get('linkReplacements') === 'on',
  });

  if (!created.ok) {
    redirectWithFlash(WIZARD_PATH, {
      problem: created.publicMessage,
      copyFrom: trimmedField(formData, 'copyFromSeasonId'),
    });
  }

  revalidatePath('/admin/catalog');
  done(
    `${created.value.season.label} is ready: ${created.value.productCount} product${
      created.value.productCount === 1 ? '' : 's'
    }, ${created.value.addOnCount} add-on${created.value.addOnCount === 1 ? '' : 's'}, ${
      created.value.replacementLinkCount
    } replacement link${created.value.replacementLinkCount === 1 ? '' : 's'}. It is closed until you open it.`,
  );
}

function done(notice: string): never {
  revalidatePath(SEASONS_PATH);
  redirectWithFlash(SEASONS_PATH, { notice });
}

function back(problem: string): never {
  redirectWithFlash(SEASONS_PATH, { problem });
}
