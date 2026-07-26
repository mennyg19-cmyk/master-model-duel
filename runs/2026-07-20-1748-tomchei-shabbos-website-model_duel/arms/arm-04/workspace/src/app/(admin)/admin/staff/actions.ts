'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { StaffRole } from '@prisma/client';

import { recordAudit } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/staff';
import { startImpersonation, stopImpersonation } from '@/lib/auth/local-session';
import { readVersionStamp } from '@/lib/forms/form-data';
import { db } from '@/lib/db';
import {
  changeStaffRole,
  inviteStaff,
  setPermissionOverride,
  setStaffStatus,
} from '@/lib/staff-service';

export type StaffFormState = { error: string | null; notice: string | null };

const STAFF_ROLES = Object.values(StaffRole);
const SETTABLE_STATUSES = ['ACTIVE', 'REVOKED'] as const;
const OVERRIDE_EFFECTS = ['GRANT', 'DENY', 'INHERIT'] as const;

const INVALID_SUBMISSION = 'invalid_submission';

export async function inviteStaffAction(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const context = await requirePermission('staff.manage');

  const role = readChoice(formData, 'role', STAFF_ROLES);
  if (!role) return { error: 'Pick one of the roles in the list.', notice: null };

  const invited = await inviteStaff(context, {
    email: String(formData.get('email') ?? ''),
    fullName: String(formData.get('fullName') ?? ''),
    role,
  });

  revalidatePath('/admin/staff');
  return invited.ok
    ? { error: null, notice: `Invited ${invited.value.email}. Confirm the account to let them sign in.` }
    : { error: invited.publicMessage, notice: null };
}

export async function changeRoleAction(formData: FormData) {
  const context = await requirePermission('staff.manage');

  const role = readChoice(formData, 'role', STAFF_ROLES);
  const expectedVersion = readVersionStamp(formData);
  if (!role || expectedVersion === null) redirectToStaff(INVALID_SUBMISSION);

  const changed = await changeStaffRole(context, {
    staffUserId: String(formData.get('staffUserId')),
    expectedVersion,
    role,
  });

  revalidatePath('/admin/staff');
  if (!changed.ok) redirectToStaff(changed.code);
}

export async function setStatusAction(formData: FormData) {
  const context = await requirePermission('staff.manage');

  const status = readChoice(formData, 'status', SETTABLE_STATUSES);
  const expectedVersion = readVersionStamp(formData);
  if (!status || expectedVersion === null) redirectToStaff(INVALID_SUBMISSION);

  const changed = await setStaffStatus(context, {
    staffUserId: String(formData.get('staffUserId')),
    expectedVersion,
    status,
  });

  revalidatePath('/admin/staff');
  if (!changed.ok) redirectToStaff(changed.code);
}

export async function setOverrideAction(formData: FormData) {
  const context = await requirePermission('staff.manage');
  const staffUserId = String(formData.get('staffUserId'));

  const effect = readChoice(formData, 'effect', OVERRIDE_EFFECTS);
  if (!effect) redirect(`/admin/staff/${staffUserId}?error=${INVALID_SUBMISSION}`);

  const changed = await setPermissionOverride(context, {
    staffUserId,
    permission: String(formData.get('permission')),
    effect,
  });

  revalidatePath(`/admin/staff/${staffUserId}`);
  if (!changed.ok) redirect(`/admin/staff/${staffUserId}?error=${changed.code}`);
}

export async function beginImpersonation(formData: FormData) {
  const context = await requirePermission('staff.impersonate');
  const staffUserId = String(formData.get('staffUserId'));

  if (staffUserId === context.actor.id) return;

  const target = await db.staffUser.findFirst({ where: { id: staffUserId, status: 'ACTIVE' } });
  if (!target) return;

  await startImpersonation(target.id);
  await recordAudit(context, {
    action: 'staff.impersonation_started',
    entityType: 'StaffUser',
    entityId: target.id,
    detail: { targetEmail: target.email },
  });

  redirect('/admin');
}

export async function endImpersonation() {
  const context = await requirePermission('dashboard.view');

  if (context.isImpersonating) {
    await recordAudit(context, {
      action: 'staff.impersonation_stopped',
      entityType: 'StaffUser',
      entityId: context.acting.id,
    });
  }

  await stopImpersonation();
  redirect('/admin');
}

function redirectToStaff(code: string): never {
  redirect(`/admin/staff?error=${code}`);
}

/** Form values are attacker-controlled strings, so a cast would hand Prisma garbage. */
function readChoice<T extends string>(
  formData: FormData,
  field: string,
  allowed: readonly T[],
): T | null {
  const value = String(formData.get(field) ?? '');
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}
