import Link from 'next/link';
import { notFound } from 'next/navigation';

import { resumePaymentAction } from './actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { formatCents } from '@/lib/core/money';
import { readOrderDetail } from '@/lib/orders/customer-orders';
import { resolveDraftOwner } from '@/lib/orders/draft-access';

export const dynamic = 'force-dynamic';

/**
 * Where the payment page sends the customer back to, paid or not.
 *
 * It reads the order through the owner filter, so the id in the URL proves
 * nothing on its own (R-121) — a guest reaches their own order with the token in
 * their cookie and nobody else's with anything.
 *
 * Whether money arrived is read from the order, never from the query string: the
 * provider redirects the browser, but only the webhook is allowed to say a
 * payment happened.
 */
export default async function ConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; payment?: string; problem?: string }>;
}) {
  const params = await searchParams;
  const owner = params.order ? await resolveDraftOwner() : null;
  if (!owner || !params.order) notFound();

  const order = await readOrderDetail(owner, params.order);
  if (!order) notFound();

  const paid = order.paymentStatus === 'PAID' || order.paymentStatus === 'OVERPAID';
  const awaitingPayment = order.status === 'PLACED' && !paid;

  return (
    <div
      className="space-y-6"
      data-testid="confirmation"
      data-status={order.status}
      data-payment-status={order.paymentStatus}
    >
      <header className="space-y-2">
        <Badge tone={paid ? 'success' : 'warning'}>
          {paid ? 'Paid' : order.status === 'CANCELLED' ? 'Cancelled' : 'Waiting for payment'}
        </Badge>
        <h1 className="text-3xl font-semibold">
          {order.orderNumber === null ? order.draftReference : `Order #${order.orderNumber}`}
        </h1>
        <p className="text-[var(--color-ink-muted)]">
          {order.seasonLabel} · {order.itemCount} item{order.itemCount === 1 ? '' : 's'} ·{' '}
          {order.recipientCount} recipient{order.recipientCount === 1 ? '' : 's'}
        </p>
      </header>

      {params.problem ? (
        <p
          role="alert"
          className="rounded-md bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
          data-testid="confirmation-problem"
        >
          {params.problem}
        </p>
      ) : null}

      {params.payment === 'cancelled' && awaitingPayment ? (
        <p
          className="rounded-md bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[var(--color-warning)]"
          data-testid="confirmation-cancelled"
        >
          You left the payment page before it finished. Your order is held — pay below to confirm it.
        </p>
      ) : null}

      <Card>
        <CardTitle>{paid ? 'Thank you' : 'Not paid yet'}</CardTitle>
        <CardDescription>
          {paid
            ? 'We have your order and your payment. A receipt is on its way to your inbox.'
            : 'Your items are held for this order. Nothing has been charged.'}
        </CardDescription>

        <dl className="mt-4 max-w-sm space-y-1 text-sm">
          <div className="flex justify-between">
            <dt>Items</dt>
            <dd>{formatCents(order.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Delivery and shipping</dt>
            <dd>{formatCents(order.fulfillmentFeeCents)}</dd>
          </div>
          <div className="flex justify-between font-medium">
            <dt>Total</dt>
            <dd data-testid="confirmation-total">{formatCents(order.totalCents)}</dd>
          </div>
          <div className="flex justify-between text-[var(--color-ink-muted)]">
            <dt>Paid</dt>
            <dd data-testid="confirmation-paid">{formatCents(order.amountPaidCents)}</dd>
          </div>
        </dl>

        {awaitingPayment ? (
          <form action={resumePaymentAction} className="mt-4">
            <input type="hidden" name="orderId" value={order.id} />
            <Button type="submit" data-testid="confirmation-pay">
              Pay {formatCents(order.totalCents - order.amountPaidCents)}
            </Button>
          </form>
        ) : null}
      </Card>

      {order.packages.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Boxes we will make up</h2>
          <ul className="space-y-1 text-sm">
            {order.packages.map((pkg) => (
              <li key={pkg.id} data-testid="confirmation-package">
                {pkg.recipientName} · {pkg.methodLabel}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-sm text-[var(--color-ink-muted)]">
        <Link href="/collection" className="underline underline-offset-4">
          Back to the collection
        </Link>
        {' · '}
        <Link href="/account/orders" className="underline underline-offset-4">
          Your orders
        </Link>
      </p>
    </div>
  );
}
