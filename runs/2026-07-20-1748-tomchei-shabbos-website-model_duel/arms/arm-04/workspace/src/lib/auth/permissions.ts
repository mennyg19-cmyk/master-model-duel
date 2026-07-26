import type { PermissionEffect, StaffRole } from '@prisma/client';

/**
 * Every gate in the app names one of these. Adding a permission means adding it
 * here first, so the override editor and the sidebar stay in sync automatically.
 */
export const PERMISSIONS = {
  'dashboard.view': 'View the admin dashboard',
  'orders.view': 'View orders',
  'orders.manage': 'Edit orders, refunds and payments',
  'customers.view': 'View the customer directory',
  'customers.manage': 'Edit customer details and their address book',
  'imports.manage': 'Stage and commit customer and product imports',
  'catalog.manage': 'Add and edit products, options and add-ons',
  'media.manage': 'Upload and assign catalog photos',
  'staff.manage': 'Add staff, change roles and edit permission overrides',
  'staff.impersonate': 'Sign in as another staff member',
  'audit.view': 'Read the security audit trail',
  'settings.manage': 'Change store settings',
  'routes.drive': 'Open assigned delivery routes',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const ROLE_DEFAULTS: Record<StaffRole, readonly Permission[]> = {
  MANAGER: ALL_PERMISSIONS,
  // Office staff take orders over the phone, so correcting a recipient's street
  // number is part of the same job as editing the order it is on (UR-014).
  STAFF: ['dashboard.view', 'orders.view', 'orders.manage', 'customers.view', 'customers.manage'],
  DRIVER: ['routes.drive'],
};

export type PermissionOverrideInput = { permission: string; effect: PermissionEffect };

export function roleDefaults(role: StaffRole): readonly Permission[] {
  return ROLE_DEFAULTS[role];
}

/**
 * DENY beats GRANT beats the role default. An explicit deny is the only way to
 * take a permission away from a Manager, and it can never be out-voted.
 */
export function hasPermission(
  role: StaffRole,
  overrides: PermissionOverrideInput[],
  permission: Permission,
): boolean {
  const matching = overrides.filter((override) => override.permission === permission);

  if (matching.some((override) => override.effect === 'DENY')) return false;
  if (matching.some((override) => override.effect === 'GRANT')) return true;

  return ROLE_DEFAULTS[role].includes(permission);
}

export function effectivePermissions(
  role: StaffRole,
  overrides: PermissionOverrideInput[],
): Permission[] {
  return ALL_PERMISSIONS.filter((permission) => hasPermission(role, overrides, permission));
}

export function isPermission(value: string): value is Permission {
  return value in PERMISSIONS;
}
