import 'server-only';

import { forbidden, unauthorized } from 'next/navigation';
import type { PermissionOverride, StaffUser } from '@prisma/client';

import { db } from '../db';
import { normalizeEmail } from '../core/normalize';
import { getExternalIdentity, getImpersonatedStaffId } from './identity';
import { effectivePermissions, hasPermission, type Permission } from './permissions';

export type StaffWithOverrides = StaffUser & { permissionOverrides: PermissionOverride[] };

/**
 * One rule for "who did this", because two would be worse than either.
 *
 * Every column that records who performed an action — `recordedByStaffUserId`,
 * `stagedByStaffUserId`, `uploadedByStaffUserId`, `ExportLog.staffUserId` and
 * the rest — is written from `actor`, the same person `recordAudit` names.
 * Money taken at the counter and a file of every donor's address have to be
 * attributable to the human who was really there, and an impersonated session
 * would otherwise file both under somebody who was not.
 *
 * `acting` is for two things only: which permissions apply, and ownership keys
 * that scope a screen to a workstation — the POS till's drafts, the driver's
 * runs. Those follow the seat, not the person, which is the whole point of
 * impersonating one.
 */
export type StaffContext = {
  /** The human who actually signed in. Audit rows and attribution name this person. */
  actor: StaffWithOverrides;
  /** Whose permissions apply right now — the impersonated staff member, or the actor. */
  acting: StaffWithOverrides;
  isImpersonating: boolean;
  permissions: Permission[];
};

export async function getStaffContext(): Promise<StaffContext | null> {
  const identity = await getExternalIdentity();
  if (!identity) return null;

  const actor = await db.staffUser.findFirst({
    where: {
      status: 'ACTIVE',
      OR: [{ externalAuthId: identity.externalId }, { email: normalizeEmail(identity.email) }],
    },
    include: { permissionOverrides: true },
  });
  if (!actor) return null;

  const acting = await resolveImpersonation(actor);

  return {
    actor,
    acting,
    isImpersonating: acting.id !== actor.id,
    permissions: effectivePermissions(acting.role, acting.permissionOverrides),
  };
}

async function resolveImpersonation(actor: StaffWithOverrides): Promise<StaffWithOverrides> {
  const impersonatedId = await getImpersonatedStaffId();
  if (!impersonatedId || impersonatedId === actor.id) return actor;

  // Only someone who still holds the impersonation permission in their own
  // right may keep an impersonation session open.
  if (!hasPermission(actor.role, actor.permissionOverrides, 'staff.impersonate')) return actor;

  const target = await db.staffUser.findFirst({
    where: { id: impersonatedId, status: 'ACTIVE' },
    include: { permissionOverrides: true },
  });

  return target ?? actor;
}

/**
 * The single authorization gate. Signed-out callers get 401, signed-in callers
 * without the permission get 403 — never a redirect, so the status code is
 * observable by tests and by the browser.
 */
export async function requirePermission(permission: Permission): Promise<StaffContext> {
  const context = await getStaffContext();
  if (!context) unauthorized();
  if (!context.permissions.includes(permission)) forbidden();
  return context;
}
