'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  NEWSLETTER_PREFERENCE_KEYS,
  type NewsletterPreference,
} from '@/lib/newsletter/preferences';
import {
  subscribe,
  unsubscribeByToken,
  updatePreferencesByToken,
} from '@/lib/newsletter/subscriptions';

export type NewsletterFormState = { error: string | null; notice: string | null };

export async function subscribeAction(
  _previous: NewsletterFormState,
  formData: FormData,
): Promise<NewsletterFormState> {
  const result = await subscribe({
    email: String(formData.get('email') ?? ''),
    source: String(formData.get('source') ?? 'storefront'),
    preferences: readPreferences(formData),
  });

  if (!result.ok) return { error: result.publicMessage, notice: null };

  return {
    error: null,
    notice: `${result.value.subscriber.email} is on the list. Every email carries an unsubscribe link.`,
  };
}

export async function savePreferencesAction(
  _previous: NewsletterFormState,
  formData: FormData,
): Promise<NewsletterFormState> {
  const token = String(formData.get('token') ?? '');
  const preferences = Object.fromEntries(
    NEWSLETTER_PREFERENCE_KEYS.map((key) => [key, formData.get(key) === 'on']),
  ) as Record<NewsletterPreference, boolean>;

  const result = await updatePreferencesByToken(token, preferences);
  if (!result.ok) return { error: result.publicMessage, notice: null };

  revalidatePath('/newsletter/manage');
  return { error: null, notice: 'Saved. These are the emails you will get.' };
}

/**
 * Unsubscribing is a POST behind a confirm button, never the GET the email link
 * opens: mail clients and security scanners fetch every link in a message, and
 * a GET that unsubscribed would quietly remove people who only opened the email.
 */
export async function unsubscribeAction(formData: FormData) {
  const token = String(formData.get('token') ?? '');
  const result = await unsubscribeByToken(token);

  redirect(
    result.ok
      ? '/newsletter/unsubscribe?state=done'
      : `/newsletter/unsubscribe?state=error&reason=${encodeURIComponent(result.publicMessage)}`,
  );
}

/** The footer form has no checkboxes, so an absent field means "leave the default". */
function readPreferences(formData: FormData): Partial<Record<NewsletterPreference, boolean>> {
  if (!formData.has('preferences-present')) return {};

  return Object.fromEntries(
    NEWSLETTER_PREFERENCE_KEYS.map((key) => [key, formData.get(key) === 'on']),
  ) as Record<NewsletterPreference, boolean>;
}
