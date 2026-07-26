import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { requirePermission } from '@/lib/auth/staff';
import { formatCents } from '@/lib/core/money';
import { listStaffOrders } from '@/lib/orders/staff-orders';

export const dynamic = 'force-dynamic';

/**
 * Placed orders, newest first, as a way into the money desk. Search, filters and
 * paging arrive with the operations hub; this list exists so the payment screen
 * is reachable, and it is deliberately capped rather than pretending to scale.
 */
export default async function AdminOrdersPage() {
  await requirePermission('orders.view');
  const orders = await listStaffOrders();

  if (orders.length === 0) {
    return <p className="text-sm text-[var(--color-ink-muted)]">No orders have been placed yet.</p>;
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Orders</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          The most recent placed orders and what has been paid against them.
        </p>
      </header>

      <table className="w-full text-sm" data-testid="order-table">
        <thead className="text-left text-[var(--color-ink-muted)]">
          <tr>
            <th className="py-2">Order</th>
            <th>Customer</th>
            <th>Status</th>
            <th>Total</th>
            <th>Paid</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr
              key={order.id}
              className="border-t border-[var(--color-line)]"
              data-testid="order-row"
              data-payment-status={order.paymentStatus}
            >
              <td className="py-2">
                <Link
                  href={`/admin/orders/${order.id}`}
                  className="text-[var(--color-brand)] underline underline-offset-4"
                >
                  {order.orderNumber === null ? order.draftReference : `#${order.orderNumber}`}
                </Link>
              </td>
              <td>{order.customerName}</td>
              <td>
                <Badge tone={order.status === 'CANCELLED' ? 'danger' : 'neutral'}>{order.status}</Badge>
              </td>
              <td>{formatCents(order.totalCents)}</td>
              <td>{formatCents(order.amountPaidCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
