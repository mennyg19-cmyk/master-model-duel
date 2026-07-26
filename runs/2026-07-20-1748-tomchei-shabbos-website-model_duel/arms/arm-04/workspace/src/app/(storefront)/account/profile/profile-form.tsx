'use client';

import { useActionState } from 'react';

import { saveProfileAction } from '../actions';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import { EMPTY_FORM_STATE } from '@/lib/forms/form-state';

export function ProfileForm({ fullName, phone }: { fullName: string; phone: string }) {
  const [state, formAction, isPending] = useActionState(saveProfileAction, EMPTY_FORM_STATE);

  return (
    <form action={formAction} className="max-w-md space-y-4" data-testid="profile-form">
      <div>
        <Label htmlFor="fullName">Your name</Label>
        <Input id="fullName" name="fullName" defaultValue={fullName} maxLength={120} required />
      </div>

      <div>
        <Label htmlFor="phone">Phone</Label>
        <Input id="phone" name="phone" defaultValue={phone} autoComplete="tel" maxLength={20} />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]" data-testid="profile-error">
          {state.error}
        </p>
      ) : null}

      {state.notice ? (
        <p className="text-sm text-[var(--color-success)]" data-testid="profile-notice">
          {state.notice}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? 'Saving…' : 'Save your details'}
      </Button>
    </form>
  );
}
