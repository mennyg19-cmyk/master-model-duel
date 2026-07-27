'use server';

import { requirePermission } from '@/lib/auth/staff';
import { redirectWithFlash, rejectWith } from '@/lib/forms/flash-redirect';
import { trimmedField } from '@/lib/forms/form-data';
import { resetSeason, seedTestData, wipeTransactionalData } from '@/lib/testing/console';
import { setTestMode } from '@/lib/testing/test-mode';

/**
 * The rehearsal switch and the three buttons behind it (R-014, R-101, R-103).
 *
 * Wiping asks for the word to be typed. It is the one action here with no
 * undo, and a mis-click on a page somebody left open is exactly how a real
 * season's orders would go.
 */
const TESTING_PATH = '/admin/settings/testing';
const SEED_HOUSEHOLDS = 12;
const WIPE_CONFIRMATION = 'WIPE';

export async function setTestModeAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('settings.manage');
  const on = trimmedField(formData, 'on') === 'true';

  await setTestMode(staff, on);

  redirectWithFlash(TESTING_PATH, {
    notice: on
      ? 'Test mode is on. Every screen now says so.'
      : 'Test mode is off. The banner is gone and the console is locked.',
  });
}

export async function seedTestDataAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('settings.manage');

  const seeded = await seedTestData(staff, {
    seasonYear: Number(trimmedField(formData, 'seasonYear')),
    householdCount: SEED_HOUSEHOLDS,
  });

  if (!seeded.ok) rejectWith(TESTING_PATH, seeded.publicMessage);

  redirectWithFlash(TESTING_PATH, {
    notice: `Seeded ${seeded.value.ordersWritten} demo orders for ${seeded.value.customersWritten} new households.`,
  });
}

export async function resetSeasonAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('settings.manage');

  const reset = await resetSeason(staff, Number(trimmedField(formData, 'seasonYear')));
  if (!reset.ok) rejectWith(TESTING_PATH, reset.publicMessage);

  redirectWithFlash(TESTING_PATH, {
    notice: `Deleted ${reset.value.ordersDeleted} orders. The catalog and the season are untouched.`,
  });
}

export async function wipeTestDataAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('settings.manage');

  if (trimmedField(formData, 'confirmation') !== WIPE_CONFIRMATION) {
    rejectWith(TESTING_PATH, `Type ${WIPE_CONFIRMATION} to confirm. Nothing was deleted.`);
  }

  const wiped = await wipeTransactionalData(staff);
  if (!wiped.ok) rejectWith(TESTING_PATH, wiped.publicMessage);

  redirectWithFlash(TESTING_PATH, {
    notice: `Wiped ${wiped.value.ordersDeleted} orders and ${wiped.value.customersDeleted} households.`,
  });
}
