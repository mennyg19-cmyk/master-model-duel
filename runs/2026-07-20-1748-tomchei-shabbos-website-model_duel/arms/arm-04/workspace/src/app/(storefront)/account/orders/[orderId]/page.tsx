import Link from 'next/link';
import { notFound } from 'next/navigation';

import { cancelDraftAction } from '../../actions';
import { requireSignedInCustomer } from '../../session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCents } from '@/lib/core/money';
import { readOrderDetail } from '@/lib/orders/customer-orders';
import { isRepeatable } from '@/lib/orders/repeatable';

export const dynamic = 'force-dynamic';

/**
 * R-039. The order id is read only through the owner filter, so a customer who
 * guesses somebody else's id gets the same 404 as an id that never existed
 * (R-121).
 */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const [{ orderId }, customer] = await Promise.all([
    params,
    requireSignedInCustomer('/account/orders'),
  ]);

  const order = await readOrderDetail({ kind: 'customer', customerId: customer.id }, orderId);
  if (!order) notFound();

  const isDraft = order.status === 'DRAFT';

  return (
    <div className="space-y-6" data-testid="order-detail" data-status={order.status}>
      <header className="space-y-2">
        <p className="text-sm text-[var(--color-ink-muted)]">
          <Link href="/account/orders" className="underline underline-offset-4">
            Your orders
          </Link>
        </p>
        <h1 className="text-3xl font-semibold">
          {order.orderNumber === null ? order.draftReference : `Order #${order.orderNumber}`}
        </h1>
        <p className="text-[var(--color-ink-muted)]">
          {order.seasonLabel} ·{' '}
          {order.placedAt
            ? `Placed ${order.placedAt.toLocaleDateString('en-US')}`
            : 'Not placed yet'}{' '}
          · <Badge tone={isDraft ? 'warning' : 'neutral'}>{order.status}</Badge>
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Items</h2>
        <ul className="space-y-2">
          {order.lines.map((line) => (
            <li
              key={line.id}
              className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4"
              data-testid="detail-line"
              data-assigned={line.recipientName === null ? 'false' : 'true'}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">
                  {line.quantity} × {line.name}
                  {line.options ? ` · ${line.options}` : ''}
                </p>
                <p className="font-medium">{formatCents(line.lineTotalCents)}</p>
              </div>

              {line.addOns.length > 0 ? (
                <p className="text-sm text-[var(--color-ink-muted)]">+ {line.addOns.join(', ')}</p>
              ) : null}

              {line.recipientName ? (
                <p className="mt-1 text-sm">
                  <span className="font-medium">{line.recipientName}</span>
                  {line.methodLabel ? ` · ${line.methodLabel}` : ''}
                  {line.destination ? ` · ${line.destination}` : ''}
                </p>
              ) : (
                <p className="mt-1 text-sm text-[var(--color-warning)]">Still needs a recipient</p>
              )}

              {line.greetingMessage ? (
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                  “{line.greetingMessage}”
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <dl className="max-w-sm space-y-1 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4 text-sm">
        <div className="flex justify-between">
          <dt>Items</dt>
          <dd data-testid="detail-subtotal">{formatCents(order.subtotalCents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Delivery and shipping</dt>
          <dd>{isDraft ? 'Worked out at checkout' : formatCents(order.fulfillmentFeeCents)}</dd>
        </div>
        <div className="flex justify-between font-medium">
          <dt>Total</dt>
          <dd data-testid="detail-total">{formatCents(order.totalCents)}</dd>
        </div>
        {isDraft ? null : (
          <div className="flex justify-between text-[var(--color-ink-muted)]">
            <dt>Paid</dt>
            <dd>
              {formatCents(order.amountPaidCents)} · {order.paymentStatus}
            </dd>
          </div>
        )}
      </dl>

      {order.packages.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Packages</h2>
          <ul className="space-y-1 text-sm">
            {order.packages.map((pkg) => (
              <li key={pkg.id} data-testid="detail-package">
                {pkg.recipientName} · {pkg.methodLabel} · {pkg.stage}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {order.status === 'PLACED' && order.amountPaidCents < order.totalCents ? (
        <Link href={`/order/confirmation?order=${order.id}`}>
          <Button data-testid="detail-pay">Finish paying</Button>
        </Link>
      ) : null}

      {isRepeatable(order.status) ? (
        <Link href={`/account/orders/${order.id}/repeat`}>
          <Button variant="secondary" data-testid="detail-repeat">
            Order again
          </Button>
        </Link>
      ) : null}

      {isDraft ? (
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/order">
            <Button data-testid="detail-continue">Continue this order</Button>
          </Link>

          <Link href="/order/checkout">
            <Button variant="secondary" data-testid="detail-checkout">
              Check out
            </Button>
          </Link>

          <form action={cancelDraftAction} className="ml-auto">
            <input type="hidden" name="orderId" value={order.id} />
            <Button type="submit" variant="danger" data-testid="detail-cancel">
              Cancel this order
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
