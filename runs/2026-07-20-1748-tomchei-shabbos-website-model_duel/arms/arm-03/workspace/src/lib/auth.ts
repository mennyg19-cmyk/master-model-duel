import {
  AuditAction,
  type PermissionOverride,
  type StaffUser,
  StaffRole,
} from "@prisma/client";
import { cookies } from "next/headers";
import { auth as clerkAuth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { writeAudit } from "@/lib/audit";
import {
  hasPermission,
  type Permission,
  resolvePermissions,
} from "@/lib/permissions";
import { SETUP_LOCK_KEY } from "@/lib/constants";
import { normalizeEmail } from "@/lib/normalize";

export type AuthIdentity = {
  clerkUserId: string;
  email: string | null;
  /** False when Clerk primary email is present but not verified — never link by email. */
  emailVerified: boolean;
  displayName: string;
};

export type StaffContext = {
  identity: AuthIdentity;
  staff: StaffUser & { permissionOverrides: PermissionOverride[] };
  effectiveStaff: StaffUser & { permissionOverrides: PermissionOverride[] };
  impersonating: boolean;
  permissions: Set<Permission>;
};

function devIdentityAllowlist(env: ReturnType<typeof getEnv>): Set<string> {
  return new Set(
    [
      env.DEV_MANAGER_USER_ID,
      env.DEV_STAFF_USER_ID,
      env.DEV_DRIVER_USER_ID,
      env.DEV_CUSTOMER_USER_ID,
      env.DEV_ACTING_USER_ID,
    ].filter((id): id is string => Boolean(id)),
  );
}

export async function getAuthIdentity(): Promise<AuthIdentity | null> {
  const env = getEnv();
  if (env.AUTH_MODE === "dev") {
    // Fail closed in production: unsigned cookie identity must never ship.
    if (env.NODE_ENV === "production") return null;
    const cookieStore = await cookies();
    // Cookie only — never trust client-supplied x-dev-user-id (spoofable).
    const acting =
      cookieStore.get("dev_user_id")?.value ?? env.DEV_ACTING_USER_ID ?? null;
    if (!acting) return null;
    if (!devIdentityAllowlist(env).has(acting)) return null;
    return {
      clerkUserId: acting,
      email: `${acting}@example.local`,
      emailVerified: true,
      displayName: acting.replace(/_/g, " "),
    };
  }

  const session = await clerkAuth();
  if (!session.userId) return null;
  const user = await currentUser();
  const primary = user?.primaryEmailAddress;
  const fallback = user?.emailAddresses[0];
  const emailAddress = primary ?? fallback ?? null;
  const email = emailAddress?.emailAddress ?? null;
  const emailVerified =
    emailAddress?.verification?.status === "verified";
  return {
    clerkUserId: session.userId,
    email: emailVerified ? email : null,
    emailVerified,
    displayName:
      [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
      (emailVerified ? email : null) ||
      session.userId,
  };
}

export async function getStaffContext(): Promise<StaffContext | null> {
  const identity = await getAuthIdentity();
  if (!identity) return null;

  const staff = await db.staffUser.findFirst({
    where: {
      OR: [
        { clerkUserId: identity.clerkUserId },
        ...(identity.email
          ? [{ email: normalizeEmail(identity.email) }]
          : []),
      ],
    },
    include: { permissionOverrides: true },
  });
  if (!staff || !staff.isActive || staff.revokedAt) return null;

  if (!staff.clerkUserId) {
    await db.staffUser.update({
      where: { id: staff.id },
      data: { clerkUserId: identity.clerkUserId, lastLoginAt: new Date() },
    });
  } else if (!staff.lastLoginAt || Date.now() - staff.lastLoginAt.getTime() > 60_000) {
    await db.staffUser.update({
      where: { id: staff.id },
      data: { lastLoginAt: new Date() },
    });
    await writeAudit({
      action: AuditAction.LOGIN,
      actorId: staff.id,
      meta: { clerkUserId: identity.clerkUserId },
    });
  }

  const activeImpersonation = await db.impersonationSession.findFirst({
    where: { impersonatorId: staff.id, active: true },
    include: {
      impersonated: { include: { permissionOverrides: true } },
    },
  });

  const effectiveStaff = activeImpersonation?.impersonated ?? staff;
  const permissions = resolvePermissions(
    effectiveStaff.role,
    effectiveStaff.permissionOverrides,
  );

  return {
    identity,
    staff,
    effectiveStaff,
    impersonating: Boolean(activeImpersonation),
    permissions,
  };
}

export async function requirePermission(permission: Permission): Promise<StaffContext> {
  const ctx = await getStaffContext();
  if (!ctx) {
    throw new AuthError(401, "Sign in required");
  }
  if (!ctx.permissions.has(permission)) {
    throw new AuthError(403, `Missing permission: ${permission}`);
  }
  return ctx;
}

/** Gate on the real signed-in staff row (ignores active impersonation). */
export async function requireActorPermission(permission: Permission): Promise<StaffContext> {
  const ctx = await getStaffContext();
  if (!ctx) {
    throw new AuthError(401, "Sign in required");
  }
  if (!hasPermission(ctx.staff, ctx.staff.permissionOverrides, permission)) {
    throw new AuthError(403, `Missing permission: ${permission}`);
  }
  return ctx;
}

const ROLE_RANK: Record<StaffRole, number> = {
  MANAGER: 3,
  STAFF: 2,
  DRIVER: 1,
};

/** True when actor may impersonate target (strictly lower role; no privilege escalation). */
export function canImpersonate(
  actor: Pick<StaffUser, "role" | "isActive" | "revokedAt"> & {
    permissionOverrides: PermissionOverride[];
  },
  target: Pick<StaffUser, "role" | "isActive" | "revokedAt"> & {
    permissionOverrides: PermissionOverride[];
  },
): boolean {
  if (!actor.isActive || actor.revokedAt) return false;
  if (!target.isActive || target.revokedAt) return false;
  if (ROLE_RANK[target.role] >= ROLE_RANK[actor.role]) return false;
  const actorPerms = resolvePermissions(actor.role, actor.permissionOverrides);
  const targetPerms = resolvePermissions(target.role, target.permissionOverrides);
  for (const permission of targetPerms) {
    if (!actorPerms.has(permission)) return false;
  }
  return true;
}

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function isSetupComplete(): Promise<boolean> {
  const managerCount = await db.staffUser.count({
    where: { role: StaffRole.MANAGER, isActive: true, revokedAt: null },
  });
  if (managerCount > 0) return true;
  const lock = await db.appSetting.findUnique({ where: { key: SETUP_LOCK_KEY } });
  return Boolean(lock?.value);
}
