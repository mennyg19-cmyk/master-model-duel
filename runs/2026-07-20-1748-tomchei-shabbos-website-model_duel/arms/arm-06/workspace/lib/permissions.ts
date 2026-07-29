import { OverrideEffect, StaffRole } from "@prisma/client";

export const PERMISSIONS = [
  "admin.access",
  "staff.manage",
  "staff.impersonate",
  "audit.view",
  "catalog.manage",
  "settings.manage",
  "customers.manage",
  "payments.manage",
  "fulfillment.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_DEFAULTS: Record<StaffRole, readonly Permission[]> = {
  MANAGER: PERMISSIONS,
  // UR-014: POS-floor staff edit customer address books (audited); drivers don't.
  // UR-011/G-028: POS staff finalize counter orders and post/void cash/check.
  // UR-001: floor staff work the package board and print batches.
  STAFF: ["admin.access", "customers.manage", "payments.manage", "fulfillment.manage"],
  DRIVER: [],
};

export interface PermissionSubject {
  role: StaffRole;
  overrides: { permission: string; effect: OverrideEffect }[];
}

// Deny override beats grant override beats role default.
export function hasPermission(subject: PermissionSubject, permission: Permission): boolean {
  const override = subject.overrides.find((entry) => entry.permission === permission);
  if (override) {
    return override.effect === "GRANT";
  }
  return ROLE_DEFAULTS[subject.role].includes(permission);
}

// Self-target blocks (R-119): a staff user cannot change their own role or
// overrides, revoke themselves, or impersonate themselves.
export function canTargetStaff(actorId: string, targetId: string): boolean {
  return actorId !== targetId;
}

const ROLE_RANK: Record<StaffRole, number> = { MANAGER: 3, STAFF: 2, DRIVER: 1 };

// Impersonation may never raise privilege: target role rank must not exceed
// the actor's. The check is on roles, so a GRANT override of
// staff.impersonate alone can never escalate someone into a manager identity.
export function canImpersonate(actorRole: StaffRole, targetRole: StaffRole): boolean {
  return ROLE_RANK[targetRole] <= ROLE_RANK[actorRole];
}

// staff.manage writes (role change, override write, create, revoke) follow the
// same rank discipline as impersonation: the actor may only touch accounts at
// or below their own role rank, and may never assign a role above it. Checked
// on roles, so a GRANT override of staff.manage alone is never a takeover path.
export function canManageStaffRole(actorRole: StaffRole, targetRole: StaffRole): boolean {
  return ROLE_RANK[targetRole] <= ROLE_RANK[actorRole];
}
