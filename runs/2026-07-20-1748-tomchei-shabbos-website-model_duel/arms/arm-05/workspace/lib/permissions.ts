export const permissions = [
  "staff.manage",
  "audit.read",
  "settings.manage",
  "orders.read",
  "customers.write",
] as const;

export type Permission = (typeof permissions)[number];
export type StaffRole = "MANAGER" | "STAFF" | "DRIVER";
export type PermissionEffect = "GRANT" | "DENY";

const rolePermissions: Record<StaffRole, readonly Permission[]> = {
  MANAGER: permissions,
  STAFF: ["orders.read"],
  DRIVER: [],
};

export function hasPermission(
  role: StaffRole,
  overrides: Partial<Record<Permission, PermissionEffect>>,
  permission: Permission,
) {
  const override = overrides[permission];
  if (override === "DENY") return false;
  if (override === "GRANT") return true;
  return rolePermissions[role].includes(permission);
}
