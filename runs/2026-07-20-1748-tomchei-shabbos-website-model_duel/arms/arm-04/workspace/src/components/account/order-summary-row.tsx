import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { formatCents } from '@/lib/core/money';
import type { OrderSummary } from '@/lib/orders/customer-orders';

const STATUS_TONE = {
  DRAFT: 'warning',
  PLACED: 'success',
  IN_FULFILLMENT: 'success',
  COMPLETED: 'neutral',
  CANCELLED: 'danger',
  DISCARDED: 'danger',
} as const;

const STATUS_LABEL = {
  DRAFT: 'In your cart',
  PLACED: 'Placed',
  IN_FULFILLMENT: 'Being packed',
  COMPLETED: 'Delivered',
  CANCELLED: 'Cancelled',
  DISCARDED: 'Discarded',
} as const;

/**
 * One row of order history (R-038). A draft is shown with the same weight as a
 * placed order because to the customer it is the same thing at an earlier stage —
 * it just quotes its draft reference instead of an order number (R-151).
 */
export function OrderSummaryRow({ order }: { order: OrderSummary }) {
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4"
      data-testid="order-row"
      data-status={order.status}
    >
      <div>
        <p className="font-medium">
          <Link
            href={`/account/orders/${order.id}`}
            className="underline underline-offset-4"
            data-testid="order-link"
          >
            {order.orderNumber === null
              ? order.draftReference
              : `Order #${order.orderNumber}`}
          </Link>{' '}
          <Badge tone={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</Badge>
        </p>
        <p className="text-sm text-[var(--color-ink-muted)]">
          {order.seasonLabel} · {order.itemCount} item{order.itemCount === 1 ? '' : 's'} ·{' '}
          {order.recipientCount} recipient{order.recipientCount === 1 ? '' : 's'}
          {order.unassignedCount > 0 ? ` · ${order.unassignedCount} without a recipient` : ''}
        </p>
      </div>

      <p className="font-medium" data-testid="order-total">
        {formatCents(order.totalCents)}
      </p>
    </li>
  );
}
