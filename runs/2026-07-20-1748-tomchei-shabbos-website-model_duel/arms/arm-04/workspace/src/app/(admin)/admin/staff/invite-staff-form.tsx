'use client';

import { useActionState } from 'react';

import { inviteStaffAction, type StaffFormState } from './actions';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/field';

const INITIAL_STATE: StaffFormState = { error: null, notice: null };

export function InviteStaffForm() {
  const [state, formAction, isPending] = useActionState(inviteStaffAction, INITIAL_STATE);

  return (
    <form action={formAction} className="mt-4 grid gap-3 sm:grid-cols-4 sm:items-end">
      <div>
        <Label htmlFor="invite-name">Full name</Label>
        <Input id="invite-name" name="fullName" required />
      </div>
      <div>
        <Label htmlFor="invite-email">Email</Label>
        <Input id="invite-email" name="email" type="email" required />
      </div>
      <div>
        <Label htmlFor="invite-role">Role</Label>
        <Select id="invite-role" name="role" defaultValue="STAFF">
          <option value="MANAGER">Manager</option>
          <option value="STAFF">Staff</option>
          <option value="DRIVER">Driver</option>
        </Select>
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? 'Inviting…' : 'Send invitation'}
      </Button>

      {state.error ? (
        <p role="alert" className="text-sm text-[var(--color-danger)] sm:col-span-4">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="text-sm text-[var(--color-success)] sm:col-span-4">{state.notice}</p>
      ) : null}
    </form>
  );
}
