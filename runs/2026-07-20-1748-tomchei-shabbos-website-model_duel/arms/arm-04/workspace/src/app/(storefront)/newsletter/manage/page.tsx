import { NewsletterPreferencesForm } from '../preferences-form';
import { unsubscribeAction } from '../../newsletter-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { loadByToken } from '@/lib/newsletter/subscriptions';

export const dynamic = 'force-dynamic';

export default async function ManageNewsletterPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const loaded = await loadByToken(token);

  if (!loaded.ok) {
    return (
      <div className="max-w-2xl space-y-3">
        <h1 className="text-3xl font-semibold">Preferences</h1>
        <p role="alert" className="text-[var(--color-danger)]" data-testid="token-error">
          {loaded.publicMessage}
        </p>
      </div>
    );
  }

  const subscriber = loaded.value;
  const isSubscribed = subscriber.status === 'SUBSCRIBED';

  return (
    <div className="max-w-2xl space-y-8" data-testid="manage-newsletter">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Preferences</h1>
        <p className="text-[var(--color-ink-muted)]">{subscriber.email}</p>
        <Badge tone={isSubscribed ? 'success' : 'neutral'} data-testid="subscription-status">
          {isSubscribed ? 'Subscribed' : 'Unsubscribed'}
        </Badge>
      </header>

      {isSubscribed ? (
        <>
          <NewsletterPreferencesForm
            mode="manage"
            token={token ?? ''}
            checked={{
              wantsSeasonAnnouncements: subscriber.wantsSeasonAnnouncements,
              wantsOrderReminders: subscriber.wantsOrderReminders,
              wantsImpactStories: subscriber.wantsImpactStories,
            }}
          />

          <form action={unsubscribeAction} className="border-t border-[var(--color-line)] pt-6">
            <input type="hidden" name="token" value={token ?? ''} />
            <p className="mb-2 text-sm text-[var(--color-ink-muted)]">
              Prefer no email at all? This stops every message immediately.
            </p>
            <Button type="submit" variant="danger">
              Unsubscribe
            </Button>
          </form>
        </>
      ) : (
        <p className="text-[var(--color-ink-muted)]">
          You are off the list. Sign up again from the newsletter page whenever you like.
        </p>
      )}
    </div>
  );
}
