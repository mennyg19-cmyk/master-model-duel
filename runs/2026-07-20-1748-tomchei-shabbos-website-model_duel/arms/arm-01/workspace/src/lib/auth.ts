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

export async function getAuthenticatedClerkUserId() {
  if (isClerkConfigured()) {
    const clerkSession = await auth();
    return clerkSession.userId;
  }

  if (process.env.ENABLE_TEST_AUTH !== "true") {
    return null;
  }
  return (await headers()).get("x-test-clerk-user-id") ?? "__local_manager__";
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

  const impersonatedStaffId = (await cookies()).get("impersonate_staff_id")?.value;
  if (!impersonatedStaffId) {
    return { actor, effective: actor };
  }

  const effective = await db.staffUser.findUnique({
    where: { id: impersonatedStaffId },
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
