import Link from 'next/link';

import { unsubscribeAction } from '../../newsletter-actions';
import { Button } from '@/components/ui/button';
import { loadByToken } from '@/lib/newsletter/subscriptions';

export const dynamic = 'force-dynamic';

/**
 * The link in an email lands here and only ever asks. Mail clients and security
 * scanners fetch every URL in a message, so unsubscribing on the GET would
 * remove people who did nothing but open the email — the confirm button posts.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; state?: string; reason?: string }>;
}) {
  const { token, state, reason } = await searchParams;

  if (state === 'done') {
    return (
      <Outcome title="You are unsubscribed">
        <p data-testid="unsubscribe-done">
          No more email from us. Nothing else about your account or past orders changed.
        </p>
      </Outcome>
    );
  }

  if (state === 'error') {
    return (
      <Outcome title="That link did not work">
        <p role="alert" className="text-[var(--color-danger)]" data-testid="token-error">
          {reason ?? 'Use the link from a recent email.'}
        </p>
      </Outcome>
    );
  }

  const loaded = await loadByToken(token);
  if (!loaded.ok) {
    return (
      <Outcome title="That link did not work">
        <p role="alert" className="text-[var(--color-danger)]" data-testid="token-error">
          {loaded.publicMessage}
        </p>
      </Outcome>
    );
  }

  if (loaded.value.status === 'UNSUBSCRIBED') {
    return (
      <Outcome title="Already unsubscribed">
        <p data-testid="unsubscribe-done">
          {loaded.value.email} is not on the list, so there is nothing to do.
        </p>
      </Outcome>
    );
  }

  return (
    <Outcome title="Unsubscribe">
      <p>
        Stop sending email to <strong>{loaded.value.email}</strong>?
      </p>
      <form action={unsubscribeAction} className="mt-4 flex items-center gap-4">
        <input type="hidden" name="token" value={token ?? ''} />
        <Button type="submit" variant="danger">
          Yes, unsubscribe me
        </Button>
        <Link
          href={`/newsletter/manage?token=${encodeURIComponent(token ?? '')}`}
          className="text-sm underline underline-offset-4"
        >
          Change which emails I get instead
        </Link>
      </form>
    </Outcome>
  );
}

function Outcome({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-xl space-y-3">
      <h1 className="text-3xl font-semibold">{title}</h1>
      <div className="text-[var(--color-ink-muted)]">{children}</div>
    </div>
  );
}
