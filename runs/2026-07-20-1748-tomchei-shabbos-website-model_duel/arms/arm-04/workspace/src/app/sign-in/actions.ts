'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { localExternalId, endLocalSession, startLocalSession } from '@/lib/auth/local-session';
import { normalizeEmail } from '@/lib/core/normalize';
import { clientIpAddress } from '@/lib/request-ip';
import { stampLogin } from '@/lib/staff-service';

export type SignInState = { error: string | null };

/** Sign-in only ever lands on a staff area, so `?next=` cannot be pointed elsewhere. */
const DESTINATION_ROOTS = ['/admin', '/driver'];

const CANNOT_SIGN_IN = 'That address cannot sign in. Ask a manager to invite or reactivate it.';

export async function signInLocally(_previous: SignInState, formData: FormData): Promise<SignInState> {
  if (env.AUTH_PROVIDER !== 'local') {
    return { error: 'This deployment signs in through Clerk.' };
  }

  const email = normalizeEmail(String(formData.get('email') ?? ''));
  const destination = safeDestination(String(formData.get('next') ?? '/admin'));

  const staff = await db.staffUser.findFirst({ where: { email, status: 'ACTIVE' } });
  if (!staff) {
    // Same message for "no such account" and "revoked" so the form cannot be
    // used to discover which addresses belong to staff.
    return { error: CANNOT_SIGN_IN };
  }

  const externalId = staff.externalAuthId ?? localExternalId(email);
  if (!staff.externalAuthId) {
    await db.staffUser.update({ where: { id: staff.id }, data: { externalAuthId: externalId } });
  }

  const requestHeaders = await headers();
  await stampLogin(staff.id, clientIpAddress(requestHeaders), requestHeaders.get('user-agent'));

  // A manager can revoke this account between the lookup above and here. Every
  // later request would 401 anyway, so say so now instead of handing out a
  // cookie that is already dead.
  const stillActive = await db.staffUser.findFirst({
    where: { id: staff.id, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!stillActive) return { error: CANNOT_SIGN_IN };

  await startLocalSession({ externalId, email, fullName: staff.fullName });

  redirect(destination);
}

export async function signOut() {
  await endLocalSession();
  redirect('/');
}

/**
 * Same-site is not enough: `?next=/api/health` is same-site and still not a page
 * anyone should land on after signing in. Only the two staff areas are allowed.
 */
function safeDestination(candidate: string): string {
  const allowed = DESTINATION_ROOTS.some(
    (root) => candidate === root || candidate.startsWith(`${root}/`),
  );
  return allowed ? candidate : '/admin';
}
