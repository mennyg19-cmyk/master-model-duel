import { createHmac, timingSafeEqual } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { isClerkConfigured } from "@/lib/env";
import { hasPermission, type Permission } from "@/lib/permissions";

export class AccessDeniedError extends Error {
  constructor(message = "You do not have permission to access this resource.") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export function createLocalTestAuthToken(userId: string, timestamp = Date.now()) {
  const secret = process.env.TEST_AUTH_SECRET;
  if (!secret) throw new Error("TEST_AUTH_SECRET is required for local test auth.");
  const payload = `${userId}.${timestamp}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${timestamp}.${signature}`;
}

export async function getAuthenticatedClerkUserId() {
  if (isClerkConfigured()) {
    const clerkSession = await auth();
    return clerkSession.userId;
  }

  if (
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_TEST_AUTH !== "true"
  ) {
    return null;
  }
  const requestHeaders = await headers();
  const host = requestHeaders.get("host")?.split(":")[0];
  if (host !== "127.0.0.1" && host !== "localhost") return null;

  const userId = requestHeaders.get("x-test-clerk-user-id");
  const token = requestHeaders.get("x-test-auth-token");
  const [timestampText, signature] = token?.split(".") ?? [];
  const timestamp = Number(timestampText);
  if (
    !userId ||
    !signature ||
    !Number.isFinite(timestamp) ||
    Math.abs(Date.now() - timestamp) > 5 * 60 * 1000
  ) {
    return null;
  }
  const expectedSignature = createLocalTestAuthToken(userId, timestamp).split(".")[1];
  const supplied = Buffer.from(signature, "hex");
  const expected = Buffer.from(expectedSignature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
    ? userId
    : null;
}

export async function getCurrentStaffUser() {
  const clerkUserId = await getAuthenticatedClerkUserId();
  if (!clerkUserId) {
    return null;
  }

  const actor =
    clerkUserId === "__local_manager__"
      ? await db.staffUser.findFirst({
          where: { role: "MANAGER", status: "ACTIVE" },
          orderBy: { createdAt: "asc" },
        })
      : await db.staffUser.findUnique({ where: { clerkUserId } });
  if (!actor || actor.status !== "ACTIVE") {
    return null;
  }

  const impersonationSessionId = (await cookies()).get("impersonation_session_id")?.value;
  if (!impersonationSessionId) {
    return { actor, effective: actor };
  }

  const impersonationSession = await db.impersonationSession.findFirst({
    where: {
      id: impersonationSessionId,
      actorStaffId: actor.id,
      endedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (!impersonationSession) return { actor, effective: actor };
  const effective = await db.staffUser.findUnique({
    where: { id: impersonationSession.targetStaffId },
  });
  if (!effective || effective.status !== "ACTIVE") {
    return { actor, effective: actor };
  }
  return { actor, effective };
}

export async function requirePermission(permission: Permission) {
  const staffSession = await getCurrentStaffUser();
  if (
    !staffSession ||
    !hasPermission(staffSession.effective, permission) ||
    (staffSession.actor.id !== staffSession.effective.id &&
      !hasPermission(staffSession.actor, "staff:impersonate"))
  ) {
    throw new AccessDeniedError();
  }
  return staffSession;
}
