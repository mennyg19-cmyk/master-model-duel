import 'server-only';

import { cookies } from 'next/headers';

import { env } from '../env';
import { isLoopbackUrl } from '../env-spec';
import { IMPERSONATION_COOKIE, SESSION_COOKIE } from './cookie-names';
import { signCookieValue } from './signed-cookie';

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: env.NODE_ENV === 'production',
} as const;

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

export async function startLocalSession(identity: { externalId: string; email: string; fullName: string }) {
  // The local provider trades a password for an email address. NODE_ENV is a
  // build flag, not a trust boundary — a staging deploy can set it to anything —
  // so the session also refuses to open unless the app is served from this
  // machine. Env validation rejects the same combination at startup; this is the
  // second lock, because a signed cookie handed out once is handed out forever.
  if (env.NODE_ENV === 'production' || !isLoopbackUrl(env.APP_URL)) {
    throw new Error(
      'AUTH_PROVIDER=local only opens a session on a loopback deployment outside production. ' +
        'Deploy with AUTH_PROVIDER=clerk.',
    );
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, signCookieValue(identity), {
    ...COOKIE_OPTIONS,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function endLocalSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(IMPERSONATION_COOKIE);
}

export async function startImpersonation(staffUserId: string) {
  const store = await cookies();
  store.set(IMPERSONATION_COOKIE, signCookieValue({ staffUserId }), {
    ...COOKIE_OPTIONS,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function stopImpersonation() {
  const store = await cookies();
  store.delete(IMPERSONATION_COOKIE);
}

export function localExternalId(email: string): string {
  return `local:${email}`;
}
