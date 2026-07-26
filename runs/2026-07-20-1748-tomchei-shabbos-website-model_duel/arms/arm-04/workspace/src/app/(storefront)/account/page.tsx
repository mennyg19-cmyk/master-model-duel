import Link from 'next/link';

import { OrderSummaryRow } from '@/components/account/order-summary-row';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { listCustomerAddresses } from '@/lib/addresses/address-book';
import { formatPhone } from '@/lib/core/phone';
import { listCustomerOrders } from '@/lib/orders/customer-orders';
import { requireSignedInCustomer } from './session';

export const dynamic = 'force-dynamic';

/** R-037. The three things a customer comes back for: the cart, the history, the book. */
export default async function AccountPage() {
  const customer = await requireSignedInCustomer('/account');
  const [orders, addresses] = await Promise.all([
    listCustomerOrders(customer.id),
    listCustomerAddresses(customer.id),
  ]);

  const draft = orders.find((order) => order.status === 'DRAFT') ?? null;
  const placed = orders.filter((order) => order.status !== 'DRAFT');

  return (
    <div className="space-y-6" data-testid="account-dashboard">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Hello, {customer.fullName}</h1>
        <p className="text-[var(--color-ink-muted)]">
          {customer.email}
          {customer.phone ? ` · ${formatPhone(customer.phone)}` : ''}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardTitle>Order in progress</CardTitle>
          {draft ? (
            <>
              <CardDescription data-testid="dashboard-draft">
                {draft.itemCount} item{draft.itemCount === 1 ? '' : 's'} · {draft.draftReference}
              </CardDescription>
              <Link
                href="/order"
                className="mt-3 inline-block text-sm text-[var(--color-brand)] underline underline-offset-4"
              >
                Continue your order
              </Link>
            </>
          ) : (
            <>
              <CardDescription>Nothing in the cart right now.</CardDescription>
              <Link
                href="/order"
                className="mt-3 inline-block text-sm text-[var(--color-brand)] underline underline-offset-4"
              >
                Start an order
              </Link>
            </>
          )}
        </Card>

        <Card>
          <CardTitle>Past orders</CardTitle>
          <CardDescription data-testid="dashboard-order-count">
            {placed.length} order{placed.length === 1 ? '' : 's'} placed
          </CardDescription>
          <Link
            href="/account/orders"
            className="mt-3 inline-block text-sm text-[var(--color-brand)] underline underline-offset-4"
          >
            See your orders
          </Link>
        </Card>

        <Card>
          <CardTitle>Address book</CardTitle>
          <CardDescription data-testid="dashboard-address-count">
            {addresses.length} recipient{addresses.length === 1 ? '' : 's'} saved
          </CardDescription>
          <Link
            href="/account/addresses"
            className="mt-3 inline-block text-sm text-[var(--color-brand)] underline underline-offset-4"
          >
            Manage recipients
          </Link>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Recent orders</h2>
        {orders.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">
            Your orders will appear here once you place one.
          </p>
        ) : (
          <ul className="space-y-2">
            {orders.slice(0, 5).map((order) => (
              <OrderSummaryRow key={order.id} order={order} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
