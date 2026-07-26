'use client';

import { useActionState } from 'react';

import { signInCustomer } from './actions';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import { EMPTY_FORM_STATE } from '@/lib/forms/form-state';

export function CustomerSignInForm({ next }: { next: string }) {
  const [state, formAction, isPending] = useActionState(signInCustomer, EMPTY_FORM_STATE);

  return (
    <form action={formAction} className="max-w-sm space-y-4" data-testid="customer-sign-in-form">
      <input type="hidden" name="next" value={next} />

      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>

      <div>
        <Label htmlFor="fullName">Your name</Label>
        <Input id="fullName" name="fullName" autoComplete="name" maxLength={120} required />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]" data-testid="sign-in-error">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? 'Signing in…' : 'Continue'}
      </Button>
    </form>
  );
}
