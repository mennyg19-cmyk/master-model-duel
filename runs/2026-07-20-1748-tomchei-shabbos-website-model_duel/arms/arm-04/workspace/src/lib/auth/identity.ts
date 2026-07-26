import 'server-only';

import { cookies } from 'next/headers';

import { env } from '../env';
import { IMPERSONATION_COOKIE, SESSION_COOKIE } from './cookie-names';
import { readSignedCookieValue } from './signed-cookie';

/**
 * Who the browser claims to be, before any role or permission is considered.
 *
 * Clerk is the production identity provider. The `local` provider exists so the
 * app, its tests and CI can run with no network and no Clerk keys; it is
 * rejected by env validation in production.
 */
export type ExternalIdentity = {
  externalId: string;
  email: string;
  fullName: string;
};

export async function getExternalIdentity(): Promise<ExternalIdentity | null> {
  return env.AUTH_PROVIDER === 'clerk' ? readClerkIdentity() : readLocalIdentity();
}

async function readClerkIdentity(): Promise<ExternalIdentity | null> {
  const { currentUser } = await import('@clerk/nextjs/server');
  const user = await currentUser();
  if (!user) return null;

  const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
  if (!email) return null;

  return {
    externalId: user.id,
    email,
    fullName: [user.firstName, user.lastName].filter(Boolean).join(' ') || email,
  };
}

async function readLocalIdentity(): Promise<ExternalIdentity | null> {
  const store = await cookies();
  const payload = readSignedCookieValue(store.get(SESSION_COOKIE)?.value);
  if (!payload?.externalId || !payload.email) return null;

  return {
    externalId: payload.externalId,
    email: payload.email,
    fullName: payload.fullName ?? payload.email,
  };
}

export async function getImpersonatedStaffId(): Promise<string | null> {
  const store = await cookies();
  const payload = readSignedCookieValue(store.get(IMPERSONATION_COOKIE)?.value);
  return payload?.staffUserId ?? null;
}
