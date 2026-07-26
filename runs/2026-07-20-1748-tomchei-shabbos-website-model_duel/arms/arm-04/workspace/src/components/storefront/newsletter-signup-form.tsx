'use client';

import { useActionState } from 'react';

import { subscribeAction, type NewsletterFormState } from '@/app/(storefront)/newsletter-actions';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';

const INITIAL_STATE: NewsletterFormState = { error: null, notice: null };

export function NewsletterSignupForm({ source, className }: { source: string; className?: string }) {
  const [state, formAction, isPending] = useActionState(subscribeAction, INITIAL_STATE);

  return (
    <form action={formAction} className={className} data-testid="newsletter-signup">
      <input type="hidden" name="source" value={source} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor={`newsletter-email-${source}`}>Email address</Label>
          <Input
            id={`newsletter-email-${source}`}
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Signing up…' : 'Keep me posted'}
        </Button>
      </div>

      {state.error ? (
        <p role="alert" className="mt-2 text-sm text-[var(--color-danger)]">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="mt-2 text-sm text-[var(--color-success)]" data-testid="newsletter-notice">
          {state.notice}
        </p>
      ) : null}
    </form>
  );
}
