import 'server-only';

import type { Prisma, StaffRole, StaffUser } from '@prisma/client';

import { db } from './db';
import { recordAudit } from './audit';
import type { DbClient } from './core/db-client';
import { normalizeEmail } from './core/normalize';
import { failure, ok, STALE_VERSION, type Result } from './core/result';
import { isPermission } from './auth/permissions';
import type { StaffContext } from './auth/staff';

export { STALE_VERSION };

/**
 * Optimistic concurrency for staff rows. The caller passes the version it read;
 * if another request already moved the row on, the update matches zero rows and
 * we report a conflict instead of silently overwriting the other change.
 */
export async function updateStaffVersioned(
  staffUserId: string,
  expectedVersion: number,
  data: Prisma.StaffUserUpdateInput,
  client: DbClient = db,
): Promise<Result<StaffUser>> {
  const updated = await client.staffUser.updateMany({
    where: { id: staffUserId, version: expectedVersion },
    data: { ...data, version: { increment: 1 } },
  });

  if (updated.count === 0) {
    return failure(
      STALE_VERSION,
      'Someone else changed this staff member while you were editing. Reload and try again.',
    );
  }

  const row = await client.staffUser.findUniqueOrThrow({ where: { id: staffUserId } });
  return ok(row);
}

export async function inviteStaff(
  context: StaffContext,
  input: { email: string; fullName: string; role: StaffRole },
): Promise<Result<StaffUser>> {
  const email = normalizeEmail(input.email);

  if (await db.staffUser.findUnique({ where: { email } })) {
    return failure('duplicate_staff_email', `A staff member already uses ${email}.`);
  }

  const created = await db.staffUser.create({
    data: { email, fullName: input.fullName.trim(), role: input.role, status: 'INVITED' },
  });

  await recordAudit(context, {
    action: 'staff.invited',
    entityType: 'StaffUser',
    entityId: created.id,
    detail: { email, role: input.role },
  });

  return ok(created);
}

export async function changeStaffRole(
  context: StaffContext,
  input: { staffUserId: string; expectedVersion: number; role: StaffRole },
): Promise<Result<StaffUser>> {
  const selfTarget = guardSelfTarget(context, input.staffUserId, 'change your own role');
  if (selfTarget) return selfTarget;

  const previous = await db.staffUser.findUnique({ where: { id: input.staffUserId } });
  if (!previous) return failure('staff_not_found', 'That staff member no longer exists.');

  const updated = await updateStaffVersioned(input.staffUserId, input.expectedVersion, {
    role: input.role,
  });
  if (!updated.ok) return updated;

  await recordAudit(context, {
    action: 'staff.role_changed',
    entityType: 'StaffUser',
    entityId: input.staffUserId,
    detail: { from: previous.role, to: input.role },
  });

  return updated;
}

export async function setStaffStatus(
  context: StaffContext,
  input: { staffUserId: string; expectedVersion: number; status: 'ACTIVE' | 'REVOKED' },
): Promise<Result<StaffUser>> {
  const selfTarget = guardSelfTarget(context, input.staffUserId, 'change your own account status');
  if (selfTarget) return selfTarget;

  const previous = await db.staffUser.findUnique({ where: { id: input.staffUserId } });
  if (!previous) return failure('staff_not_found', 'That staff member no longer exists.');

  // `confirmedAt` answers "when did this person first accept their invite", so a
  // later reactivation must not overwrite it.
  const timestamps =
    input.status === 'ACTIVE'
      ? { confirmedAt: previous.confirmedAt ?? new Date(), revokedAt: null }
      : { revokedAt: new Date() };

  const updated = await updateStaffVersioned(input.staffUserId, input.expectedVersion, {
    status: input.status,
    ...timestamps,
  });
  if (!updated.ok) return updated;

  await recordAudit(context, {
    action: input.status === 'ACTIVE' ? 'staff.confirmed' : 'staff.revoked',
    entityType: 'StaffUser',
    entityId: input.staffUserId,
  });

  return updated;
}

export async function setPermissionOverride(
  context: StaffContext,
  input: { staffUserId: string; permission: string; effect: 'GRANT' | 'DENY' | 'INHERIT' },
): Promise<Result<null>> {
  const selfTarget = guardSelfTarget(context, input.staffUserId, 'edit your own permissions');
  if (selfTarget) return selfTarget;

  if (!isPermission(input.permission)) {
    return failure('unknown_permission', `"${input.permission}" is not a permission this app defines.`);
  }
  const permission = input.permission;

  if (input.effect === 'INHERIT') {
    await db.permissionOverride.deleteMany({ where: { staffUserId: input.staffUserId, permission } });
  } else {
    await db.permissionOverride.upsert({
      where: { staffUserId_permission: { staffUserId: input.staffUserId, permission } },
      create: { staffUserId: input.staffUserId, permission, effect: input.effect },
      update: { effect: input.effect },
    });
  }

  await recordAudit(context, {
    action: 'staff.permission_override_changed',
    entityType: 'StaffUser',
    entityId: input.staffUserId,
    detail: { permission, effect: input.effect },
  });

  return ok(null);
}

export async function stampLogin(staffUserId: string, ipAddress: string | null, userAgent: string | null) {
  await db.$transaction([
    db.staffUser.update({ where: { id: staffUserId }, data: { lastLoginAt: new Date() } }),
    db.staffLoginSession.create({ data: { staffUserId, ipAddress, userAgent } }),
  ]);
}

/** R-119: nobody edits their own role, status or permissions, not even a manager. */
function guardSelfTarget(
  context: StaffContext,
  targetStaffUserId: string,
  attemptedAction: string,
): Result<never> | null {
  if (context.acting.id !== targetStaffUserId && context.actor.id !== targetStaffUserId) return null;
  return failure('self_target_blocked', `You cannot ${attemptedAction}. Ask another manager.`);
}
