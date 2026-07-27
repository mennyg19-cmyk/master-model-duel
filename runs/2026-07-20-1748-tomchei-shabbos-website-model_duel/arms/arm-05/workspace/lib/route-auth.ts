import { auth, currentUser } from "@clerk/nextjs/server";
import { hasStaffPermission, findStaffByClerkUserId, type StaffUser } from "@/lib/staff-store";
import type { Permission } from "@/lib/permissions";
import { isClerkConfigured } from "@/lib/env";
import { readDevSession } from "@/lib/dev-auth";

export type Authorization =
  | { ok: true; staffMember: StaffUser }
  | { ok: false; status: 401 | 403 | 503; error: string };

export type Authentication =
  | { ok: true; userId: string; email?: string; emailVerified?: boolean }
  | { ok: false; status: 401 | 503; error: string };

export async function authenticate(
  request: Request,
  includeEmail = false,
): Promise<Authentication> {
  const devSession = readDevSession(request);
  if (devSession) {
    return { ok: true, userId: devSession.userId, email: devSession.email, emailVerified: true };
  }
  if (!isClerkConfigured()) {
    return { ok: false, status: 503, error: "Authentication is not configured." };
  }

  const { userId } = await auth();
  if (!userId) return { ok: false, status: 401, error: "Sign in is required." };
  if (!includeEmail) return { ok: true, userId };

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  if (!email) return { ok: false, status: 401, error: "Your signed-in account needs a primary email address." };
  return {
    ok: true,
    userId,
    email,
    emailVerified: user.primaryEmailAddress?.verification?.status === "verified",
  };
}

export async function authorize(request: Request, permission?: Permission): Promise<Authorization> {
  const authentication = await authenticate(request);
  if (!authentication.ok) return authentication;

  const staffMember = await findStaffByClerkUserId(authentication.userId);
  if (!staffMember || staffMember.revokedAt) {
    return { ok: false, status: 403, error: "You do not have staff access." };
  }
  if (permission && !hasStaffPermission(staffMember, permission)) {
    return { ok: false, status: 403, error: "You do not have permission for this action." };
  }
  return { ok: true, staffMember };
}

export function hasSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin;
}
