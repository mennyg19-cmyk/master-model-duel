'use client';

import { useActionState } from 'react';

import { createFirstManager, type SetupFormState } from './actions';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';

const INITIAL_STATE: SetupFormState = { error: null };

export function SetupForm() {
  const [state, formAction, isPending] = useActionState(createFirstManager, INITIAL_STATE);

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <div>
        <Label htmlFor="fullName">Full name</Label>
        <Input id="fullName" name="fullName" required autoComplete="name" />
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? 'Creating…' : 'Create first manager'}
      </Button>
    </form>
  );
}
