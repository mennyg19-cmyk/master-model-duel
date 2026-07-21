import { cookies } from "next/headers";
import { OrderStatus, type Order } from "@prisma/client";
import { AuthError, getAuthIdentity, getStaffContext } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  GUEST_DRAFT_COOKIE,
  guestTokenMatches,
} from "@/lib/orders/guest-token";
import { linkOrCreateCustomer } from "@/lib/customers";

export type DraftActor =
  | { kind: "customer"; customerId: string; clerkUserId: string }
  | { kind: "guest"; token: string }
  | { kind: "staff"; staffId: string; customerId?: string | null };

export async function resolveCustomerId(): Promise<string | null> {
  const identity = await getAuthIdentity();
  if (!identity) return null;
  const existing = await db.customer.findUnique({
    where: { clerkUserId: identity.clerkUserId },
  });
  if (existing) return existing.id;
  const linked = await linkOrCreateCustomer({
    clerkUserId: identity.clerkUserId,
    email: identity.email,
    emailVerified: identity.emailVerified,
    displayName: identity.displayName,
  });
  if (!linked.ok) return null;
  return linked.value.customerId;
}

/** Guest draft auth is cookie-only (httpOnly) — no header exfil path. */
export async function readGuestTokenFromRequest(_request?: Request): Promise<string | null> {
  const jar = await cookies();
  return jar.get(GUEST_DRAFT_COOKIE)?.value ?? null;
}

/**
 * Anti-enumeration draft access:
 * - Auth drafts: only owning customer (or staff with admin.access)
 * - Guest drafts: only matching guest token; never leak existence cross-customer
 */
export async function loadDraftForAccess(
  draftRef: string,
  request?: Request,
): Promise<{ order: Order & { lines: unknown[] }; actor: DraftActor }> {
  const found = await db.order.findUnique({
    where: { draftRef },
    include: {
      lines: {
        include: {
          product: true,
          productOption: true,
          addOns: { include: { addOn: true } },
          savedAddress: true,
          fulfillmentMethod: true,
        },
        orderBy: { createdAt: "asc" },
      },
      customer: true,
    },
  });

  // Uniform 404 — never reveal whether draftRef exists to wrong principal.
  if (!found || found.status === OrderStatus.DISCARDED) {
    throw new AuthError(404, "Draft not found");
  }
  const order = found;

  const staff = await getStaffContext();
  if (staff?.permissions.has("admin.access")) {
    return {
      order,
      actor: { kind: "staff", staffId: staff.effectiveStaff.id, customerId: order.customerId },
    };
  }

  const customerId = await resolveCustomerId();
  if (order.customerId) {
    if (!customerId || customerId !== order.customerId) {
      throw new AuthError(404, "Draft not found");
    }
    const identity = await getAuthIdentity();
    if (!identity) {
      throw new AuthError(404, "Draft not found");
    }
    return {
      order,
      actor: {
        kind: "customer",
        customerId,
        clerkUserId: identity.clerkUserId,
      },
    };
  }

  // Guest draft
  if (order.guestClearedAt) {
    throw new AuthError(404, "Draft not found");
  }
  const token = await readGuestTokenFromRequest(request);
  if (!token || !guestTokenMatches(token, order.guestAccessTokenHash, order.guestTokenVersion)) {
    throw new AuthError(404, "Draft not found");
  }
  return { order, actor: { kind: "guest", token } };
}

export async function assertCanMutateDraft(
  draftRef: string,
  request?: Request,
) {
  const loaded = await loadDraftForAccess(draftRef, request);
  if (loaded.order.status !== OrderStatus.DRAFT) {
    throw new AuthError(409, "Only draft orders can be edited");
  }
  return loaded;
}
