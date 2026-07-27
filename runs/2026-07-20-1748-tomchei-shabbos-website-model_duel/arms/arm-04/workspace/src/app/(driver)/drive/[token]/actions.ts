'use server';

import { revalidatePath } from 'next/cache';

import { redirectWithFlash } from '@/lib/forms/flash-redirect';
import { trimmedField } from '@/lib/forms/form-data';
import { driverRoutePath } from '@/lib/routing/paths';
import { driverSessionMatches, startDriverSession } from '@/lib/routing/driver-session';
import { checkRoutePin, findLinkByToken, linkNeedsPin, touchLink } from '@/lib/routing/route-links';
import { markStopDelivered } from '@/lib/routing/route-service';

/**
 * What a volunteer with a van can press (UR-004, UR-015, G-025).
 *
 * No staff session is involved, so every action re-resolves the token from the
 * URL rather than trusting a route id in a form field. A revoked link stops
 * working on the next tap, which is the point of being able to revoke it.
 */
export async function submitPinAction(formData: FormData): Promise<void> {
  const token = trimmedField(formData, 'token');
  const link = await findLinkByToken(token);

  if (!link) problemOnDriverPage(token, 'This link is no longer live. Ask the office for a new one.');

  const checked = await checkRoutePin(link.id, trimmedField(formData, 'pin'));
  if (!checked.ok) problemOnDriverPage(token, checked.publicMessage);

  await startDriverSession(link.id);
  revalidatePath(driverRoutePath(token));
  redirectWithFlash(driverRoutePath(token), { notice: 'Here is your route.' });
}

export async function driverDeliveredAction(formData: FormData): Promise<void> {
  const token = trimmedField(formData, 'token');
  const link = await findLinkByToken(token);

  if (!link) problemOnDriverPage(token, 'This link is no longer live. Ring the office.');

  if (linkNeedsPin(link) && !(await driverSessionMatches(link.id))) {
    problemOnDriverPage(token, 'Enter the PIN first.');
  }

  // No staff actor: the person tapping this has no account. The audit row is
  // written as "system" and names the link in its detail, which is the only
  // identity a magic link has.
  const delivered = await markStopDelivered(null, {
    routeId: link.routeId,
    stopId: trimmedField(formData, 'stopId'),
    linkId: link.id,
    seasonId: null,
  });

  if (!delivered.ok) problemOnDriverPage(token, delivered.publicMessage);

  await touchLink(link.id);
  revalidatePath(driverRoutePath(token));

  redirectWithFlash(driverRoutePath(token), {
    notice: delivered.value.routeCompleted
      ? `${delivered.value.recipientName} done. That was the last one — thank you.`
      : `${delivered.value.recipientName} done. ${delivered.value.remaining} to go.`,
  });
}

function problemOnDriverPage(token: string, problem: string): never {
  redirectWithFlash(driverRoutePath(token), { problem });
}
