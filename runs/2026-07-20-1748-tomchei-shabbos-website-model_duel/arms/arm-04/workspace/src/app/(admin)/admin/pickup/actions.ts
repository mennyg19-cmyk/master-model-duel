'use server';

import { revalidatePath } from 'next/cache';

import { requirePermission } from '@/lib/auth/staff';
import { requireWorkingSeasonOrRedirect } from '@/lib/admin/working-season';
import { redirectWithFlash } from '@/lib/forms/flash-redirect';
import { trimmedField } from '@/lib/forms/form-data';
import { sendPickupReady, stampPickedUp, sweepPickupsReady } from '@/lib/pickup/pickup-service';
import { PICKUP_PATH } from '@/lib/routing/paths';

/**
 * The counter (UR-010, G-026). Two buttons per box and one sweep: tell them it
 * is here, and stamp it when they take it home.
 */
export async function notifyPickupReadyAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('fulfillment.manage');

  const sent = await sendPickupReady(staff, {
    packageId: trimmedField(formData, 'packageId'),
    seasonId: await counterSeasonId(),
  });

  if (!sent.ok) problemAtCounter(sent.publicMessage);

  noticeAtCounter(
    `${sent.value.recipientName}: ${sent.value.summary}. Holding until ${sent.value.expiresAt.toDateString()}.`,
  );
}

export async function sweepPickupReadyAction(): Promise<void> {
  const staff = await requirePermission('fulfillment.manage');
  const swept = await sweepPickupsReady(staff, await counterSeasonId());

  noticeAtCounter(`Everything in stock has been told. ${swept.summary}.`);
}

export async function stampPickedUpAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('fulfillment.manage');

  const stamped = await stampPickedUp(staff, {
    packageId: trimmedField(formData, 'packageId'),
    seasonId: await counterSeasonId(),
  });

  if (!stamped.ok) problemAtCounter(stamped.publicMessage);
  noticeAtCounter(`${stamped.value.recipientName} collected.`);
}

function counterSeasonId(): Promise<string> {
  return requireWorkingSeasonOrRedirect(PICKUP_PATH, 'There is no season, so the counter is empty.');
}

function noticeAtCounter(notice: string): never {
  revalidatePath(PICKUP_PATH);
  redirectWithFlash(PICKUP_PATH, { notice });
}

function problemAtCounter(problem: string): never {
  redirectWithFlash(PICKUP_PATH, { problem });
}
