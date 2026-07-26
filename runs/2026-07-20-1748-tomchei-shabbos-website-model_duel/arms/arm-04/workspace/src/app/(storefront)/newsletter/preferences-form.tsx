'use client';

import { useActionState } from 'react';

import {
  savePreferencesAction,
  subscribeAction,
  type NewsletterFormState,
} from '../newsletter-actions';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import {
  NEWSLETTER_PREFERENCES,
  type NewsletterPreference,
} from '@/lib/newsletter/preferences';

type Checked = Record<NewsletterPreference, boolean>;

const INITIAL_STATE: NewsletterFormState = { error: null, notice: null };

/**
 * The same checkbox list serves signing up and editing later. Signing up posts
 * an email address; editing posts a signed token instead, because a subscriber
 * has no account to log into.
 */
export function NewsletterPreferencesForm(
  props: { mode: 'subscribe'; source: string } | { mode: 'manage'; token: string; checked: Checked },
) {
  const [state, formAction, isPending] = useActionState(
    props.mode === 'subscribe' ? subscribeAction : savePreferencesAction,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="space-y-4" data-testid={`newsletter-${props.mode}`}>
      <input type="hidden" name="preferences-present" value="1" />

      {props.mode === 'subscribe' ? (
        <>
          <input type="hidden" name="source" value={props.source} />
          <div className="max-w-sm">
            <Label htmlFor="newsletter-page-email">Email address</Label>
            <Input
              id="newsletter-page-email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </div>
        </>
      ) : (
        <input type="hidden" name="token" value={props.token} />
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Send me</legend>
        {Object.entries(NEWSLETTER_PREFERENCES).map(([key, label]) => (
          <label key={key} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name={key}
              defaultChecked={
                props.mode === 'manage' ? props.checked[key as NewsletterPreference] : true
              }
              className="mt-0.5"
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>

      <Button type="submit" disabled={isPending}>
        {props.mode === 'subscribe' ? 'Sign me up' : 'Save preferences'}
      </Button>

      {state.error ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="text-sm text-[var(--color-success)]" data-testid="newsletter-notice">
          {state.notice}
        </p>
      ) : null}
    </form>
  );
}
