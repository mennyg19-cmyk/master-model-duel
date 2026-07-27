import type { PermissionEffect, StaffRole } from '@prisma/client';

/**
 * Every gate in the app names one of these. Adding a permission means adding it
 * here first, so the override editor and the sidebar stay in sync automatically.
 */
export const PERMISSIONS = {
  'dashboard.view': 'View the admin dashboard',
  'orders.view': 'View orders',
  'orders.manage': 'Edit orders, refunds and payments',
  'fulfillment.manage': 'Move packages through packing, split boxes and print batches',
  'customers.view': 'View the customer directory',
  'customers.manage': 'Edit customer details and their address book',
  'imports.manage': 'Stage and commit customer and product imports',
  'catalog.manage': 'Add and edit products, options and add-ons',
  'media.manage': 'Upload and assign catalog photos',
  'staff.manage': 'Add staff, change roles and edit permission overrides',
  'staff.impersonate': 'Sign in as another staff member',
  'audit.view': 'Read the security audit trail',
  'settings.manage': 'Change store settings',
  'seasons.manage': 'Open and close seasons, schedule the flip and run the new-season wizard',
  'routes.manage': 'Plan delivery routes, hand out driver links and reroute boxes',
  'routes.drive': 'Open assigned delivery routes',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const ROLE_DEFAULTS: Record<StaffRole, readonly Permission[]> = {
  MANAGER: ALL_PERMISSIONS,
  // Office staff take orders over the phone, so correcting a recipient's street
  // number is part of the same job as editing the order it is on (UR-014).
  // Packing is what most of the STAFF role does on the two nights that matter,
  // so the board and the printer are theirs by default (UR-005).
  // Planning a route is packing-table work done by the same people on the same
  // two nights, so it comes with the board. Driving is not: a route link is a
  // credential handed to a volunteer, and `routes.drive` is what it grants.
  // Neither is opening a season: that puts the shop live and rewrites what it
  // sells, so `seasons.manage` stays with the manager (UR-008).
  STAFF: [
    'dashboard.view',
    'orders.view',
    'orders.manage',
    'fulfillment.manage',
    'routes.manage',
    'customers.view',
    'customers.manage',
  ],
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
