import 'server-only';

import { cookies } from 'next/headers';

import { DRIVER_LINK_COOKIE } from '../auth/cookie-names';
import { BROWSER_COOKIE_OPTIONS } from '../auth/local-session';
import { readSignedCookieValue, signCookieValue } from '../auth/signed-cookie';

/**
 * What a driver carries after answering the PIN.
 *
 * The cookie holds the link id and nothing else, signed the same way a staff
 * session is. It is not the credential — the token in the URL is — so a stolen
 * cookie without the URL reaches nothing, and a revoked link stops working the
 * moment the office revokes it because every page re-reads the link row.
 *
 * It lasts a day at most: shorter than the link, long enough for one Purim run.
 */
const DRIVER_SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

export async function startDriverSession(linkId: string): Promise<void> {
  const store = await cookies();
  store.set(DRIVER_LINK_COOKIE, signCookieValue({ linkId }), {
    ...BROWSER_COOKIE_OPTIONS,
    maxAge: DRIVER_SESSION_MAX_AGE_SECONDS,
  });
}

/** True when this browser already answered the PIN for exactly this link. */
export async function driverSessionMatches(linkId: string): Promise<boolean> {
  const store = await cookies();
  const payload = readSignedCookieValue(store.get(DRIVER_LINK_COOKIE)?.value);
  return payload?.linkId === linkId;
}
