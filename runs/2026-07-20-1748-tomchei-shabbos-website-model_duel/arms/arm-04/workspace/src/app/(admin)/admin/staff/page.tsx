import Link from 'next/link';
import { StaffRole } from '@prisma/client';

import { InviteStaffForm } from './invite-staff-form';
import { staffActionError } from './action-errors';
import { beginImpersonation, changeRoleAction, setStatusAction } from './actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/field';
import { requirePermission } from '@/lib/auth/staff';
import { db } from '@/lib/db';
import { formatDateTime } from '@/lib/core/dates';

export const dynamic = 'force-dynamic';

const ROLES = Object.values(StaffRole);

const STATUS_TONE = { ACTIVE: 'success', INVITED: 'warning', REVOKED: 'danger' } as const;

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const context = await requirePermission('staff.manage');
  const actionError = staffActionError((await searchParams).error);
  const staff = await db.staffUser.findMany({
    orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
    include: { _count: { select: { permissionOverrides: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Staff</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Roles set the baseline. Per-person overrides on each staff member add or remove single
          permissions. You cannot change your own role, status or permissions.
        </p>
      </div>

      {actionError ? (
        <p
          role="alert"
          data-testid="staff-action-error"
          className="rounded-md bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]"
        >
          {actionError}
        </p>
      ) : null}

      <Card>
        <CardTitle>Invite a staff member</CardTitle>
        <InviteStaffForm />
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--color-line)] bg-[var(--color-surface-muted)] text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Last sign-in</th>
              <th className="px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((member) => {
              const isSelf = member.id === context.actor.id;

              return (
                <tr key={member.id} className="border-b border-[var(--color-line)] last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/staff/${member.id}`}
                      className="font-medium text-[var(--color-brand)] underline"
                    >
                      {member.fullName}
                    </Link>
                    <div className="text-[var(--color-ink-muted)]">{member.email}</div>
                    {member._count.permissionOverrides > 0 ? (
                      <div className="text-xs text-[var(--color-ink-muted)]">
                        {member._count.permissionOverrides} permission override(s)
                      </div>
                    ) : null}
                  </td>

                  <td className="px-4 py-3">
                    {isSelf ? (
                      <span>{member.role}</span>
                    ) : (
                      <form action={changeRoleAction} className="flex items-center gap-2">
                        <input type="hidden" name="staffUserId" value={member.id} />
                        <input type="hidden" name="version" value={member.version} />
                        <Select name="role" defaultValue={member.role} className="w-32">
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </Select>
                        <Button type="submit" variant="secondary">
                          Save
                        </Button>
                      </form>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[member.status]}>{member.status}</Badge>
                  </td>

                  <td className="px-4 py-3 text-[var(--color-ink-muted)]">
                    {member.lastLoginAt ? formatDateTime(member.lastLoginAt) : 'never'}
                  </td>

                  <td className="px-4 py-3">
                    {isSelf ? (
                      <span className="text-[var(--color-ink-muted)]">You</span>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <form action={setStatusAction}>
                          <input type="hidden" name="staffUserId" value={member.id} />
                          <input type="hidden" name="version" value={member.version} />
                          <input
                            type="hidden"
                            name="status"
                            value={member.status === 'ACTIVE' ? 'REVOKED' : 'ACTIVE'}
                          />
                          <Button
                            type="submit"
                            variant={member.status === 'ACTIVE' ? 'danger' : 'secondary'}
                          >
                            {member.status === 'ACTIVE' ? 'Revoke' : 'Activate'}
                          </Button>
                        </form>

                        {context.permissions.includes('staff.impersonate') &&
                        member.status === 'ACTIVE' ? (
                          <form action={beginImpersonation}>
                            <input type="hidden" name="staffUserId" value={member.id} />
                            <Button type="submit" variant="ghost">
                              Sign in as
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
