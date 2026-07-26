'use server';

import { redirect } from 'next/navigation';

import { localExternalId, startLocalSession } from '@/lib/auth/local-session';
import { normalizeEmail } from '@/lib/core/normalize';
import { findOrCreateLocalCustomer } from '@/lib/customers';
import type { FormState } from '@/lib/forms/form-state';
import { claimGuestDraft } from '@/lib/orders/cart-service';
import { clearGuestToken, readGuestOwner } from '@/lib/orders/draft-access';
import { env } from '@/lib/env';
import { readStoreState } from '@/lib/store-state';

/** A customer only ever lands back on the storefront, never on a staff area. */
const CUSTOMER_DESTINATION_ROOTS = ['/account', '/order', '/collection'];

export async function signInCustomer(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (env.AUTH_PROVIDER !== 'local') {
    return { error: 'This deployment signs in through Clerk.', notice: null };
  }

  const customer = await findOrCreateLocalCustomer({
    email: String(formData.get('email') ?? ''),
    fullName: String(formData.get('fullName') ?? ''),
  });
  if (!customer.ok) return { error: customer.publicMessage, notice: null };

  const email = normalizeEmail(customer.value.email);
  await startLocalSession({
    externalId: customer.value.externalAuthId ?? localExternalId(email),
    email,
    fullName: customer.value.fullName,
  });

  await claimAnyGuestDraft(customer.value.id);

  redirect(safeDestination(String(formData.get('next') ?? '/account')));
}

/**
 * R-022, R-023. The cart a guest built before signing in becomes the account's
 * cart. The cookie is cleared only when the claim succeeds — a guest whose
 * account already has an order in progress keeps their guest cart exactly where
 * it was rather than losing it to a failed hand-over.
 */
async function claimAnyGuestDraft(customerId: string): Promise<void> {
  const guest = await readGuestOwner();
  if (!guest || guest.kind !== 'guest') return;

  const store = await readStoreState();
  if (!store.season) return;

  const claimed = await claimGuestDraft(customerId, guest, store.season.id);
  if (claimed.ok) await clearGuestToken();
}

/**
 * `?next=` is attacker-controlled. The home page is the one exact match allowed —
 * a prefix test against "/" would let anything through, including the
 * protocol-relative `//elsewhere.example` that browsers read as another host.
 *
 * The path is canonicalized before it is measured against the list, because
 * `/account/../admin` passes a plain `startsWith` test and then arrives at
 * `/admin` once the browser has tidied it up.
 */
function safeDestination(candidate: string): string {
  if (!candidate.startsWith('/')) return '/account';

  // Resolved against a host we never use: `..` segments collapse the way the
  // browser would collapse them, and any host the candidate managed to name is
  // dropped along with it, so only a path of our own can come back.
  const { pathname, search } = new URL(candidate, 'https://own.invalid');
  if (pathname === '/') return '/';

  const allowed = CUSTOMER_DESTINATION_ROOTS.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
  return allowed ? `${pathname}${search}` : '/account';
}
