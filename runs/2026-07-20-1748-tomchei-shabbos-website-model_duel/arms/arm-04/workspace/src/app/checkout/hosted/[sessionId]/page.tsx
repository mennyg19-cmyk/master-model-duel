import Link from 'next/link';
import { notFound } from 'next/navigation';

import { payHostedSessionAction } from './actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { formatCents } from '@/lib/core/money';
import { readLocalHostedSession } from '@/lib/payments/local-hosted';

export const dynamic = 'force-dynamic';

/**
 * The offline stand-in for the provider's hosted payment page.
 *
 * It exists only while `PAYMENT_PROVIDER=local`, which the environment schema
 * allows only when the app answers on loopback — everywhere else this route is
 * a 404 and the customer is on the provider's own page. Pressing pay sends the
 * same signed event the provider would send, to the same endpoint.
 */
export default async function HostedCheckoutPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const session = await readLocalHostedSession(sessionId);
  if (!session) notFound();

  return (
    <main className="mx-auto max-w-md space-y-6 p-6" data-testid="hosted-checkout">
      <header className="space-y-2">
        <Badge tone="warning">Development payment page</Badge>
        <h1 className="text-2xl font-semibold">{session.orderLabel}</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          This deployment is not connected to a card processor. Confirming here sends the same signed
          callback the processor would, so everything after the payment behaves exactly as it will in
          production — but no money moves.
        </p>
      </header>

      <Card>
        <CardTitle>Amount due</CardTitle>
        <CardDescription>Charged in one go when you confirm.</CardDescription>

        <p className="mt-3 text-3xl font-semibold" data-testid="hosted-amount">
          {formatCents(session.amountCents)}
        </p>

        <form action={payHostedSessionAction} className="mt-4 flex items-center gap-3">
          <input type="hidden" name="sessionId" value={session.sessionId} />
          <input type="hidden" name="orderId" value={session.orderId} />
          <Button type="submit" data-testid="hosted-pay">
            Confirm payment
          </Button>

          <Link
            href={`/order/confirmation?order=${session.orderId}&payment=cancelled`}
            className="text-sm underline underline-offset-4"
            data-testid="hosted-cancel"
          >
            Cancel
          </Link>
        </form>
      </Card>
    </main>
  );
}
