import { forbidden, unauthorized } from "next/navigation";
import { db } from "@/lib/db";
import { readSession } from "@/lib/auth/session";
import { resolvePermissions, type Permission } from "@/lib/auth/permissions";
import type { StaffRole } from "@prisma/client";

export type StaffContext = {
  /** The staff member whose permissions apply (the impersonated user when impersonating). */
  actingAs: {
    id: string;
    email: string;
    name: string;
    role: StaffRole;
    permissions: Set<Permission>;
  };
  /** The real logged-in staff member. Differs from actingAs during impersonation. */
  realUser: { id: string; email: string; name: string; role: StaffRole };
  isImpersonating: boolean;
  sessionId: string;
};

export async function getStaffContext(): Promise<StaffContext | null> {
  const session = await readSession();
  if (!session || session.staffUser.status !== "ACTIVE") return null;

  const realUser = session.staffUser;
  let effective = realUser;
  if (session.impersonatedStaffId) {
    const target = await db.staffUser.findUnique({
      where: { id: session.impersonatedStaffId },
      include: { permissionOverrides: true },
    });
    if (target && target.status === "ACTIVE") effective = target;
  }

  return {
    actingAs: {
      id: effective.id,
      email: effective.email,
      name: effective.name,
      role: effective.role,
      permissions: resolvePermissions(effective.role, effective.permissionOverrides),
    },
    realUser: { id: realUser.id, email: realUser.email, name: realUser.name, role: realUser.role },
    isImpersonating: effective.id !== realUser.id,
    sessionId: session.id,
  };
}

/** Page-side gate: renders the 401/403 pages with real status codes. */
export async function requirePermissionPage(permission: Permission): Promise<StaffContext> {
  const staff = await getStaffContext();
  if (!staff) unauthorized();
  if (!staff.actingAs.permissions.has(permission)) forbidden();
  return staff;
}

/** API-side gate: returns a Response to send, or the staff context to proceed with. */
export async function requirePermissionApi(
  permission: Permission
): Promise<{ staff: StaffContext } | { response: Response }> {
  const staff = await getStaffContext();
  if (!staff) {
    return { response: Response.json({ error: "Not signed in" }, { status: 401 }) };
  }
  if (!staff.actingAs.permissions.has(permission)) {
    return {
      response: Response.json(
        { error: `Missing permission: ${permission}` },
        { status: 403 }
      ),
    };
  }
  return { staff };
}
