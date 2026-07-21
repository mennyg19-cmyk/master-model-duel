import { createHmac, randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getCustomerContext } from "@/lib/auth/customer-session";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { cartSchema, type Cart, type CartLine } from "@/lib/order-builder/cart";
import { saveToAddressBook } from "@/lib/addresses/book";

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

const APPEND_ATTEMPTS = 5;

export type AppendResult = { appended: true } | { appended: false; reason: "existing-draft" };

function cartOf(lines: CartLine[]): Cart {
  return { onOrderRecipient: null, lines };
}

function isSerializationFailure(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

/**
 * Atomically append lines to the owner's ACTIVE draft, creating one when none
 * exists. This is the ONLY safe way to add lines to a draft you did not just
 * read in the same request (repeat orders, bulk repeat):
 *
 * - Existing draft: the update is guarded on the `updatedAt` we read
 *   (optimistic lock). A concurrent write bumps it, the guarded update matches
 *   0 rows, and the loop re-reads the fresh cart — no lost lines.
 * - No draft, guest/POS owner: `@@unique([seasonId, guestTokenHash])` makes
 *   the create race-safe; the loser loops back into the append (or skip) path.
 * - No draft, customer owner (no unique constraint): the existence check and
 *   the create ride one SERIALIZABLE transaction, so two concurrent creators
 *   conflict — the loser aborts (P2034) and retries into the append path.
 *
 * `ifDraftExists: "skip"` makes the existence check atomic with creation for
 * callers that must never touch an in-progress draft (bulk repeat).
 */
export async function appendLinesToDraft(
  seasonId: string,
  owner: DraftOwner,
  lines: CartLine[],
  ifDraftExists: "append" | "skip" = "append"
): Promise<AppendResult> {
  if (owner.kind === "anonymous") throw new Error("Cannot append lines to an anonymous draft");

  for (let attempt = 0; attempt < APPEND_ATTEMPTS; attempt += 1) {
    const existing = await findActiveDraft(seasonId, owner);
    if (existing) {
      if (ifDraftExists === "skip") return { appended: false, reason: "existing-draft" };
      const cart = parseCart(existing.cart);
      const merged: Cart = { ...cart, lines: [...cart.lines, ...lines] };
      const guarded = await db.orderDraft.updateMany({
        where: { id: existing.id, status: "ACTIVE", updatedAt: existing.updatedAt },
        data: { cart: merged },
      });
      if (guarded.count === 1) return { appended: true };
      continue; // lost the optimistic race — re-read and merge again
    }

    if (owner.kind === "guest") {
      try {
        await db.orderDraft.create({
          data: { seasonId, guestTokenHash: owner.tokenHash, cart: cartOf(lines) },
        });
        return { appended: true };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Either a concurrent create won (loop back — append or skip against
        // it) or a non-ACTIVE draft holds the hash (resurrect it, guarded on
        // the stale status so a concurrent resurrection can't double-apply).
        const resurrected = await db.orderDraft.updateMany({
          where: { seasonId, guestTokenHash: owner.tokenHash, status: { not: "ACTIVE" } },
          data: { cart: cartOf(lines), status: "ACTIVE" },
        });
        if (resurrected.count === 1) return { appended: true };
        continue;
      }
    }

    try {
      const created = await db.$transaction(
        async (tx) => {
          const race = await tx.orderDraft.findFirst({
            where: { seasonId, customerId: owner.customerId, status: "ACTIVE" },
            select: { id: true },
          });
          if (race) return false;
          await tx.orderDraft.create({
            data: { seasonId, customerId: owner.customerId, cart: cartOf(lines) },
          });
          return true;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
      if (created) return { appended: true };
      // A draft appeared between our findActiveDraft and the transaction — loop back and append to it.
    } catch (error) {
      if (!isSerializationFailure(error)) throw error;
    }
  }

  throw new Error("The draft is being updated by another request — try again");
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

/**
 * POS drafts (UR-006, UR-011): the same OrderDraft table keyed by a
 * deterministic per-customer marker in guestTokenHash. Not a secret — every
 * POS API sits behind a staff permission gate — the marker just keeps one
 * resumable POS cart per customer per season without ever colliding with the
 * customer's own web draft (which lives under customerId).
 */
export function posDraftOwner(customerId: string): DraftOwner {
  return { kind: "guest", tokenHash: `pos|${customerId}` };
}

// Server-side assignment rules, shared by the storefront draft API and the
// POS draft API (same builder, same rules — UR-006):
// - "new recipient" auto-saves to the owning customer's address book (G-019)
//   and the line is rewritten to point at the saved entry.
// - address-book assignments must point into that customer's own book;
//   anything else is dropped back to unassigned rather than trusted.
export async function applyAssignmentRules(cart: Cart, customerId: string | null): Promise<Cart> {
  const ownedAddressIds = customerId
    ? new Set(
        (
          await db.customerAddress.findMany({ where: { customerId }, select: { id: true } })
        ).map((address) => address.id)
      )
    : new Set<string>();

  const lines = [];
  for (const line of cart.lines) {
    if (line.assignment?.type === "newRecipient" && customerId) {
      const saved = await saveToAddressBook(customerId, line.assignment.address);
      ownedAddressIds.add(saved.id);
      lines.push({ ...line, assignment: { type: "addressBook" as const, addressId: saved.id } });
      continue;
    }
    if (line.assignment?.type === "addressBook" && !ownedAddressIds.has(line.assignment.addressId)) {
      lines.push({ ...line, assignment: null });
      continue;
    }
    lines.push(line);
  }
  return { ...cart, lines };
}
