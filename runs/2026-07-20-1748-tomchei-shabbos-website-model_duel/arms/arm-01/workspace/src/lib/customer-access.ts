import { createHash, randomBytes } from "node:crypto";
import { getAuthenticatedClerkUserId, getCurrentStaffUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";

export const GUEST_DRAFT_ACCESS_DAYS = 30;

export function hashDraftAccessToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createGuestDraftAccess() {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + GUEST_DRAFT_ACCESS_DAYS * 24 * 60 * 60 * 1000,
  );
  return { token, tokenHash: hashDraftAccessToken(token), expiresAt };
}

export function getDraftAccessToken(request: Request) {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("draft_access_token="));
  return cookie ? decodeURIComponent(cookie.split("=").slice(1).join("=")) : null;
}

export async function getAuthenticatedCustomer() {
  const clerkUserId = await getAuthenticatedClerkUserId();
  if (!clerkUserId) return null;
  return db.customerAccount.findUnique({
    where: { clerkUserId },
    include: { customer: true },
  });
}

export async function findAccessibleDraft(request: Request, draftId: string) {
  const staffSession = await getCurrentStaffUser();
  if (staffSession && hasPermission(staffSession.effective, "admin:view")) {
    return db.order.findFirst({ where: { id: draftId, status: "DRAFT" } });
  }
  const account = await getAuthenticatedCustomer();
  if (account?.customerId) {
    return db.order.findFirst({
      where: { id: draftId, customerId: account.customerId, status: "DRAFT" },
    });
  }

  const token = getDraftAccessToken(request);
  if (!token) return null;
  return db.order.findFirst({
    where: {
      id: draftId,
      status: "DRAFT",
      guestAccessTokenHash: hashDraftAccessToken(token),
      guestAccessExpiresAt: { gt: new Date() },
    },
  });
}
