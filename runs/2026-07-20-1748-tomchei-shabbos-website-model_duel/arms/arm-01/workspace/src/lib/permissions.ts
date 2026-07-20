import type { StaffRole } from "@prisma/client";

export const permissions = [
  "admin:view",
  "staff:manage",
  "staff:impersonate",
  "audit:view",
  "settings:manage",
  "payments:manage",
  "orders:manage",
] as const;

export type Permission = (typeof permissions)[number];

const rolePermissions: Record<StaffRole, readonly Permission[]> = {
  MANAGER: permissions,
  STAFF: ["admin:view"],
  DRIVER: [],
};

type PermissionSubject = {
  role: StaffRole;
  grantPermissions: string[];
  denyPermissions: string[];
};

export function hasPermission(
  staffUser: PermissionSubject,
  permission: Permission,
) {
  if (staffUser.denyPermissions.includes(permission)) {
    return false;
  }
  return (
    rolePermissions[staffUser.role].includes(permission) ||
    staffUser.grantPermissions.includes(permission)
  );
}
