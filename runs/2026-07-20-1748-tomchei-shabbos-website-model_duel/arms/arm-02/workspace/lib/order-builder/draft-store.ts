import { createHmac, randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getCustomerContext } from "@/lib/auth/customer-session";
import { cartSchema, type Cart } from "@/lib/order-builder/cart";

// Draft ownership (R-121, R-023): a draft is reachable ONLY through the
// customer session cookie or the guest draft cookie. No API accepts a draft id
// from the client, so there is nothing to enumerate — a second browser without
// the cookie simply has no draft.
export const GUEST_DRAFT_COOKIE = "tomchei_guest_draft";
const GUEST_DRAFT_TTL_DAYS = 14;

function hashGuestToken(token: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(`guest-draft:${token}`).digest("hex");
}

export type DraftOwner =
  | { kind: "customer"; customerId: string }
  | { kind: "guest"; tokenHash: string }
  | { kind: "anonymous" };

/** Who the current request's draft belongs to, from cookies alone. */
export async function resolveDraftOwner(): Promise<DraftOwner> {
  const customer = await getCustomerContext();
  if (customer) return { kind: "customer", customerId: customer.id };
  const cookieStore = await cookies();
  const guestToken = cookieStore.get(GUEST_DRAFT_COOKIE)?.value;
  if (guestToken) return { kind: "guest", tokenHash: hashGuestToken(guestToken) };
  return { kind: "anonymous" };
}

export async function findActiveDraft(seasonId: string, owner: DraftOwner) {
  if (owner.kind === "customer") {
    return db.orderDraft.findFirst({
      where: { seasonId, customerId: owner.customerId, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
    });
  }
  if (owner.kind === "guest") {
    return db.orderDraft.findFirst({
      where: { seasonId, guestTokenHash: owner.tokenHash, status: "ACTIVE" },
    });
  }
  return null;
}

/**
 * Save the cart, creating the draft on first write. An anonymous visitor
 * becomes a guest here: mint the access token, set the httpOnly cookie, store
 * only its HMAC (R-023 — a DB dump can't be replayed as cookies).
 */
export async function saveDraft(seasonId: string, owner: DraftOwner, cart: Cart) {
  const existing = await findActiveDraft(seasonId, owner);
  if (existing) {
    return db.orderDraft.update({ where: { id: existing.id }, data: { cart } });
  }

  if (owner.kind === "customer") {
    return db.orderDraft.create({
      data: { seasonId, customerId: owner.customerId, cart },
    });
  }

  const token = owner.kind === "guest" ? null : randomBytes(32).toString("hex");
  const tokenHash = owner.kind === "guest" ? owner.tokenHash : hashGuestToken(token!);
  let draft;
  try {
    draft = await db.orderDraft.create({
      data: { seasonId, guestTokenHash: tokenHash, cart },
    });
  } catch (error) {
    // (seasonId, guestTokenHash) is unique: a concurrent first save (or a
    // non-ACTIVE draft holding the hash) lands here. Recover by updating the
    // row that won instead of surfacing a 500.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
    draft = await db.orderDraft.update({
      where: { seasonId_guestTokenHash: { seasonId, guestTokenHash: tokenHash } },
      data: { cart, status: "ACTIVE" },
    });
  }
  if (token) {
    const cookieStore = await cookies();
    cookieStore.set(GUEST_DRAFT_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: GUEST_DRAFT_TTL_DAYS * 24 * 3600,
    });
  }
  return draft;
}

/**
 * Drop the guest-draft cookie without touching any draft row. Called on
 * login/register/logout so a guest draft from a shared device can never
 * re-attach itself to (or leak addresses to) whoever uses the browser next.
 */
export async function clearGuestDraftCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(GUEST_DRAFT_COOKIE);
}

/** Cancel the current draft (account "cancel draft" and builder "start over"). */
export async function discardDraft(seasonId: string, owner: DraftOwner): Promise<boolean> {
  const draft = await findActiveDraft(seasonId, owner);
  if (!draft) return false;
  await db.orderDraft.update({ where: { id: draft.id }, data: { status: "DISCARDED" } });
  if (owner.kind === "guest") {
    const cookieStore = await cookies();
    cookieStore.delete(GUEST_DRAFT_COOKIE);
  }
  return true;
}

/**
 * Called by checkout (P5) after an order is successfully placed — the ONLY
 * path that clears a guest draft (R-022 guest-clear-on-success). Failures and
 * abandoned checkouts leave the draft and cookie alone.
 */
export async function completeDraft(draftId: string, ownedGuestCookie: boolean): Promise<void> {
  await db.orderDraft.update({ where: { id: draftId }, data: { status: "COMPLETED" } });
  if (ownedGuestCookie) {
    const cookieStore = await cookies();
    cookieStore.delete(GUEST_DRAFT_COOKIE);
  }
}

export function parseCart(raw: unknown): Cart {
  return cartSchema.parse(raw);
}
