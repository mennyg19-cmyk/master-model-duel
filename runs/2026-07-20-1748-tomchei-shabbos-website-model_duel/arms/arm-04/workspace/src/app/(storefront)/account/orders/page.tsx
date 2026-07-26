import Link from 'next/link';

import { requireSignedInCustomer } from '../session';
import { OrderSummaryRow } from '@/components/account/order-summary-row';
import { listCustomerOrders } from '@/lib/orders/customer-orders';

export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  'draft-cancelled': 'Your order was cancelled. Nothing was charged.',
  'missing-draft': 'That order is not one you can cancel any more.',
  'draft-busy': 'Someone else moved that order while you were looking at it. Reload and try again.',
};

export default async function AccountOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; problem?: string }>;
}) {
  const [params, customer] = await Promise.all([
    searchParams,
    requireSignedInCustomer('/account/orders'),
  ]);
  const orders = await listCustomerOrders(customer.id);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Your orders</h1>
        <p className="text-[var(--color-ink-muted)]">
          Every order you have placed, plus the one you are still building.
        </p>
      </header>

      {params.notice && MESSAGES[params.notice] ? (
        <p
          className="rounded-md bg-[var(--color-success-soft)] px-3 py-2 text-sm text-[var(--color-success)]"
          data-testid="orders-notice"
        >
          {MESSAGES[params.notice]}
        </p>
      ) : null}

      {params.problem && MESSAGES[params.problem] ? (
        <p
          role="alert"
          className="rounded-md bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
          data-testid="orders-problem"
        >
          {MESSAGES[params.problem]}
        </p>
      ) : null}

      {orders.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-muted)]">
          You have not ordered yet.{' '}
          <Link href="/order" className="underline underline-offset-4">
            Build your first order
          </Link>
          .
        </p>
      ) : (
        <ul className="space-y-2" data-testid="order-list">
          {orders.map((order) => (
            <OrderSummaryRow key={order.id} order={order} />
          ))}
        </ul>
      )}
    </div>
  );
}
