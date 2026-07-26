import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AddressBookEditor } from './address-book-editor';
import { BackLink } from '@/components/admin/list-controls';
import { Badge } from '@/components/ui/badge';
import { requirePermission } from '@/lib/auth/staff';
import { listCustomerAddresses } from '@/lib/addresses/address-book';
import { formatCents } from '@/lib/core/money';
import { formatPhone } from '@/lib/core/phone';
import { db } from '@/lib/db';
import { CUSTOMER_ORDER_LIMIT, listCustomerOrders } from '@/lib/orders/customer-orders';
import { posBuilderPath } from '@/lib/pos/paths';

export const dynamic = 'force-dynamic';

export default async function AdminCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const [{ customerId }, { edit }, context] = await Promise.all([
    params,
    searchParams,
    requirePermission('customers.view'),
  ]);

  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) notFound();

  const [addresses, orders] = await Promise.all([
    listCustomerAddresses(customer.id),
    listCustomerOrders(customer.id),
  ]);

  const editing = edit ? (addresses.find((address) => address.id === edit) ?? null) : null;
  const canEdit = context.permissions.includes('customers.manage');
  const canSell = context.permissions.includes('orders.manage');

  return (
    <div className="space-y-6">
      <BackLink href="/admin/customers">Customers</BackLink>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{customer.fullName}</h1>
          <p className="text-sm text-[var(--color-ink-muted)]">
            {customer.email}
            {customer.phone ? ` · ${formatPhone(customer.phone)}` : ''} · joined{' '}
            {customer.createdAt.toLocaleDateString('en-US')}
          </p>
        </div>

        {canSell ? (
          <Link
            href={posBuilderPath(customer.id)}
            className="underline underline-offset-4"
            data-testid="customer-sell"
          >
            Ring up an order
          </Link>
        ) : null}
      </header>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Orders</h2>
          {orders.length === CUSTOMER_ORDER_LIMIT ? (
            <Link
              href={`/admin/orders?q=${encodeURIComponent(customer.email)}`}
              className="text-sm underline underline-offset-4"
              data-testid="customer-all-orders"
            >
              The rest are on the order desk
            </Link>
          ) : null}
        </div>

        {orders.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">No orders yet.</p>
        ) : (
          <ul className="space-y-1 text-sm" data-testid="staff-order-list">
            {orders.map((order) => (
              <li key={order.id} className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/admin/orders/${order.id}`}
                  className="font-medium underline underline-offset-4"
                >
                  {order.orderNumber === null ? order.draftReference : `#${order.orderNumber}`}
                </Link>
                <Badge tone={order.status === 'DRAFT' ? 'warning' : 'neutral'}>{order.status}</Badge>
                <span className="text-[var(--color-ink-muted)]">
                  {order.seasonLabel} · {order.itemCount} item{order.itemCount === 1 ? '' : 's'} ·{' '}
                  {formatCents(order.totalCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canEdit ? (
        <AddressBookEditor customerId={customer.id} addresses={addresses} editing={editing} />
      ) : (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Address book</h2>
          <p className="text-sm text-[var(--color-ink-muted)]">
            You can see this customer but not change their records.
          </p>
        </section>
      )}
    </div>
  );
}
