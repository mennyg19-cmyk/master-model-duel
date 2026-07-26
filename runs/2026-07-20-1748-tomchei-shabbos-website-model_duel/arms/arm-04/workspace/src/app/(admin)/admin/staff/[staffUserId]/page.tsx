import Link from 'next/link';
import { notFound } from 'next/navigation';

import { staffActionError } from '../action-errors';
import { setOverrideAction } from '../actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/field';
import { requirePermission } from '@/lib/auth/staff';
import { ALL_PERMISSIONS, PERMISSIONS, hasPermission, roleDefaults } from '@/lib/auth/permissions';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function StaffDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ staffUserId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const context = await requirePermission('staff.manage');
  const { staffUserId } = await params;
  const actionError = staffActionError((await searchParams).error);

  const member = await db.staffUser.findUnique({
    where: { id: staffUserId },
    include: { permissionOverrides: true },
  });
  if (!member) notFound();

  const isSelf = member.id === context.actor.id;
  const defaults = roleDefaults(member.role);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/staff" className="text-sm text-[var(--color-brand)] underline">
          Back to staff
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{member.fullName}</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          {member.email} · <Badge>{member.role}</Badge> <Badge>{member.status}</Badge>
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
        <CardTitle>Permission overrides</CardTitle>
        <CardDescription>
          Inherit follows the role. Grant adds a permission the role does not include. Deny removes
          one the role does include, and deny always wins.
        </CardDescription>

        {isSelf ? (
          <p className="mt-4 text-sm text-[var(--color-danger)]">
            You cannot edit your own permissions. Ask another manager.
          </p>
        ) : null}

        <ul className="mt-4 divide-y divide-[var(--color-line)]">
          {ALL_PERMISSIONS.map((permission) => {
            const override = member.permissionOverrides.find((row) => row.permission === permission);
            const isEffective = hasPermission(member.role, member.permissionOverrides, permission);

            return (
              <li key={permission} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{PERMISSIONS[permission]}</div>
                  <div className="text-xs text-[var(--color-ink-muted)]">
                    <code>{permission}</code> · role default:{' '}
                    {defaults.includes(permission) ? 'allowed' : 'not allowed'}
                  </div>
                </div>

                <Badge tone={isEffective ? 'success' : 'neutral'}>
                  {isEffective ? 'allowed' : 'blocked'}
                </Badge>

                <form action={setOverrideAction} className="flex items-center gap-2">
                  <input type="hidden" name="staffUserId" value={member.id} />
                  <input type="hidden" name="permission" value={permission} />
                  <Select name="effect" defaultValue={override?.effect ?? 'INHERIT'} className="w-32">
                    <option value="INHERIT">Inherit</option>
                    <option value="GRANT">Grant</option>
                    <option value="DENY">Deny</option>
                  </Select>
                  <Button type="submit" variant="secondary" disabled={isSelf}>
                    Apply
                  </Button>
                </form>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
