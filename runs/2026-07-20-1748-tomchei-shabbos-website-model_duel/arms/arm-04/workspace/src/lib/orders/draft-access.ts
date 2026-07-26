import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { cookies } from 'next/headers';
import type { Order, Prisma } from '@prisma/client';

import { GUEST_DRAFT_COOKIE } from '../auth/cookie-names';
import { BROWSER_COOKIE_OPTIONS } from '../auth/local-session';
import type { DbClient } from '../core/db-client';
import { getCurrentCustomer } from '../customers';
import { db } from '../db';

/**
 * Who is allowed to touch a draft.
 *
 * Every read and every write in the builder goes through a `DraftOwner`, which
 * is the only thing that turns into a `where` clause. An order id or a draft
 * reference taken from a URL is never enough on its own — that is what stops
 * someone walking ids to read other people's carts (R-121).
 */
export type DraftOwner =
  | { kind: 'customer'; customerId: string }
  | { kind: 'guest'; tokenHash: string };

/**
 * A guest's cart lives about as long as the season does. Shorter and people
 * lose a cart they built on Sunday and came back to on Tuesday.
 */
const GUEST_TOKEN_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** 32 bytes of randomness: the token is the only credential a guest has. */
export function createGuestToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Stored hashed, like a password would be. A database dump then carries no
 * working keys to other people's carts, and the unique index still stops two
 * guests from sharing a draft.
 */
export function hashGuestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function readGuestOwner(): Promise<DraftOwner | null> {
  const store = await cookies();
  const token = store.get(GUEST_DRAFT_COOKIE)?.value;
  return token ? { kind: 'guest', tokenHash: hashGuestToken(token) } : null;
}

/**
 * Who this request may build a cart as, without creating anything. A signed-in
 * customer wins over a leftover guest cookie: after signing in, the account is
 * the owner and the guest draft is claimed rather than shadowed.
 */
export async function resolveDraftOwner(): Promise<DraftOwner | null> {
  const customer = await getCurrentCustomer();
  if (customer) return { kind: 'customer', customerId: customer.id };
  return readGuestOwner();
}

/**
 * The same question from inside a server action, where a first-time guest gets a
 * token. Rendering cannot set cookies, which is why adding the first item — not
 * loading the page — is what starts a guest cart.
 */
export async function resolveDraftOwnerForWrite(): Promise<DraftOwner> {
  const existing = await resolveDraftOwner();
  if (existing) return existing;

  const token = createGuestToken();
  await writeGuestToken(token);
  return { kind: 'guest', tokenHash: hashGuestToken(token) };
}

/** Only callable from a server action or route handler; a render cannot set cookies. */
export async function writeGuestToken(token: string): Promise<void> {
  const store = await cookies();
  store.set(GUEST_DRAFT_COOKIE, token, {
    ...BROWSER_COOKIE_OPTIONS,
    maxAge: GUEST_TOKEN_MAX_AGE_SECONDS,
  });
}

export async function clearGuestToken(): Promise<void> {
  const store = await cookies();
  store.delete(GUEST_DRAFT_COOKIE);
}

/**
 * The owner half of every draft query. Guests match on the hashed token and
 * nothing else; an account matches on its own id, so a customer cannot reach a
 * draft that is still anonymous until they claim it.
 */
export function ownerFilter(owner: DraftOwner): Prisma.OrderWhereInput {
  return owner.kind === 'customer'
    ? { customerId: owner.customerId }
    : { guestTokenHash: owner.tokenHash };
}

export function ownerColumns(owner: DraftOwner): Pick<Prisma.OrderUncheckedCreateInput, 'customerId' | 'guestTokenHash'> {
  return owner.kind === 'customer'
    ? { customerId: owner.customerId }
    : { guestTokenHash: owner.tokenHash };
}

/** The draft this owner is building for the season, or null. */
export async function findOwnedDraft(
  owner: DraftOwner,
  seasonId: string,
  client: DbClient = db,
): Promise<Order | null> {
  return client.order.findFirst({
    where: { ...ownerFilter(owner), seasonId, status: 'DRAFT' },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Reads one of this owner's orders whatever its status — the account order
 * pages and the cancel action both need it. A miss is a miss whether the order
 * belongs to somebody else or does not exist, so the caller can only answer 404.
 */
export async function findOwnedOrder(owner: DraftOwner, orderId: string): Promise<Order | null> {
  return db.order.findFirst({ where: { id: orderId, ...ownerFilter(owner) } });
}
