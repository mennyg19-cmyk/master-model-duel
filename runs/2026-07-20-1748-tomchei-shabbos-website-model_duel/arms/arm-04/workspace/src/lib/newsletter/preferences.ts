/**
 * The three things the org actually sends. Each one is a column, so a query can
 * target it.
 *
 * These labels are rendered by the preferences form, which is a client
 * component, so they live apart from the subscription service — that module
 * reaches the database and cannot be imported into the browser bundle.
 */
export const NEWSLETTER_PREFERENCES = {
  wantsSeasonAnnouncements: 'Tell me when a new Purim season opens',
  wantsOrderReminders: 'Remind me before the ordering deadline',
  wantsImpactStories: 'Send occasional stories about where the food goes',
} as const;

export type NewsletterPreference = keyof typeof NEWSLETTER_PREFERENCES;

export const NEWSLETTER_PREFERENCE_KEYS = Object.keys(
  NEWSLETTER_PREFERENCES,
) as NewsletterPreference[];
