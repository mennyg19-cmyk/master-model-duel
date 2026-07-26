import { NewsletterPreferencesForm } from './preferences-form';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default function NewsletterPage() {
  return (
    <div className="max-w-2xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Newsletter</h1>
        <p className="text-[var(--color-ink-muted)]">
          A season announcement, a deadline reminder, and the occasional story about where the food
          goes. Nothing else, and one click to stop.
        </p>
      </header>

      <NewsletterPreferencesForm mode="subscribe" source="newsletter-page" />

      <Card>
        <CardTitle>Already subscribed?</CardTitle>
        <CardDescription>
          Every email we send carries a link that opens your own preferences page, so there is
          nothing to remember and no password to reset. Use the link in the most recent email.
        </CardDescription>
      </Card>
    </div>
  );
}
