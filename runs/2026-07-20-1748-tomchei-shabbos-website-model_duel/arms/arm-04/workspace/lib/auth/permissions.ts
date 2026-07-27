import type { OverrideEffect, StaffRole } from "@prisma/client";

export const PERMISSIONS = {
  "staff.manage": "Add staff, change roles, edit permission overrides, revoke accounts",
  "staff.impersonate": "Act as another staff member (audited)",
  "audit.view": "View the security audit log",
  "settings.manage": "Edit organization settings",
  "orders.view": "View orders (placeholder until ordering phases land)",
  "catalog.manage": "Create and edit products, options, and add-ons",
  "media.manage": "Upload and manage media library files",
  "customers.manage": "Look up customers and edit their address books (audited)",
  "payments.record": "Post and void cash/check payments on orders (audited)",
  "payments.refund": "Issue Stripe refunds (audited)",
  "orders.manage": "Finalize and discard orders on behalf of customers",
  "fulfillment.manage": "Work the package board: split, regroup, statuses, print batches",
  "email.manage": "Run the email hub: campaigns, lists, subscribers, templates",
  "reports.view": "View financial reports, run CSV exports and payment reconciliation",
  "imports.legacy": "Run the legacy data migration pipeline (audited)",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const ROLE_DEFAULTS: Record<StaffRole, Permission[]> = {
  MANAGER: ALL_PERMISSIONS,
  STAFF: ["orders.view", "customers.manage", "payments.record", "orders.manage", "fulfillment.manage"],
  DRIVER: [],
};

export type OverrideInput = { permission: string; effect: OverrideEffect };

// Role gives the baseline; per-user overrides grant or deny individual permissions on top.
export function resolvePermissions(role: StaffRole, overrides: OverrideInput[]): Set<Permission> {
  const granted = new Set<Permission>(ROLE_DEFAULTS[role]);
  for (const override of overrides) {
    const permission = override.permission as Permission;
    if (!(permission in PERMISSIONS)) continue;
    if (override.effect === "GRANT") granted.add(permission);
    else granted.delete(permission);
  }
  return granted;
}
