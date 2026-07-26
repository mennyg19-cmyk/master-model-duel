'use client';

import { useActionState } from 'react';

import { signInLocally, type SignInState } from './actions';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';

const INITIAL_STATE: SignInState = { error: null };

export function LocalSignInForm({ next }: { next: string }) {
  const [state, formAction, isPending] = useActionState(signInLocally, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <Label htmlFor="email">Staff email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
