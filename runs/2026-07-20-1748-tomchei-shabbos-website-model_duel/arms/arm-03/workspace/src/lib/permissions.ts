import { PermissionEffect, StaffRole, type PermissionOverride, type StaffUser } from "@prisma/client";

export const PERMISSIONS = [
  "admin.access",
  "staff.manage",
  "staff.impersonate",
  "settings.read",
  "settings.write",
  "audit.read",
  "driver.access",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_DEFAULTS: Record<StaffRole, readonly Permission[]> = {
  MANAGER: PERMISSIONS,
  STAFF: ["admin.access", "settings.read", "audit.read"],
  DRIVER: ["driver.access"],
};

export function roleDefaultPermissions(role: StaffRole): readonly Permission[] {
  return ROLE_DEFAULTS[role];
}

export function resolvePermissions(
  role: StaffRole,
  overrides: Pick<PermissionOverride, "permission" | "effect">[],
): Set<Permission> {
  const granted = new Set<Permission>(ROLE_DEFAULTS[role]);
  for (const override of overrides) {
    if (!PERMISSIONS.includes(override.permission as Permission)) continue;
    const permission = override.permission as Permission;
    if (override.effect === PermissionEffect.GRANT) granted.add(permission);
    if (override.effect === PermissionEffect.DENY) granted.delete(permission);
  }
  return granted;
}

export function hasPermission(
  staff: Pick<StaffUser, "role" | "isActive" | "revokedAt">,
  overrides: Pick<PermissionOverride, "permission" | "effect">[],
  permission: Permission,
): boolean {
  if (!staff.isActive || staff.revokedAt) return false;
  return resolvePermissions(staff.role, overrides).has(permission);
}

export function permissionLabels(): Record<Permission, string> {
  return {
    "admin.access": "Admin shell",
    "staff.manage": "Manage staff",
    "staff.impersonate": "Impersonate staff",
    "settings.read": "Read settings",
    "settings.write": "Write settings",
    "audit.read": "Read audit log",
    "driver.access": "Driver portal",
  };
}
