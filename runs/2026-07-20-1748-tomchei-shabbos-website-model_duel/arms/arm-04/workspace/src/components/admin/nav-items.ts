import type { Permission } from '@/lib/auth/permissions';

/** The sidebar and the page gates read the same list, so a link can never point at a 403. */
export const ADMIN_NAV: { href: string; label: string; permission: Permission }[] = [
  { href: '/admin', label: 'Dashboard', permission: 'dashboard.view' },
  { href: '/admin/staff', label: 'Staff', permission: 'staff.manage' },
  { href: '/admin/audit', label: 'Audit log', permission: 'audit.view' },
  { href: '/admin/settings', label: 'Settings', permission: 'settings.manage' },
];
