import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { formatCents } from '@/lib/core/money';
import { humanizeStatus, paymentStatusTone } from '@/lib/orders/order-labels';
import type { StaffOrderRow } from '@/lib/orders/staff-orders';

/**
 * A short list of orders that need something doing to them (R-050).
 *
 * Every row says what is owed as well as what it cost, because the queues are
 * about the difference: an order in "waiting on payment" is only there because
 * those two numbers disagree.
 */
export function OrderQueue({
  title,
  rows,
  empty,
  testId,
}: {
  title: string;
  rows: StaffOrderRow[];
  empty: string;
  testId: string;
}) {
  return (
    <section
      className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4"
      data-testid={testId}
      data-count={rows.length}
    >
      <h3 className="text-sm font-semibold">
        {title} ({rows.length})
      </h3>

      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--color-line)] text-sm">
          {rows.map((order) => (
            <li key={order.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="queue-row">
              <Link
                href={`/admin/orders/${order.id}`}
                className="font-medium text-[var(--color-brand)] underline underline-offset-4"
              >
                {order.orderNumber === null ? order.draftReference : `#${order.orderNumber}`}
              </Link>
              <span>{order.customerName}</span>
              <Badge tone={paymentStatusTone(order.paymentStatus)}>
                {humanizeStatus(order.paymentStatus)}
              </Badge>
              <span className="ml-auto text-[var(--color-ink-muted)]">
                {formatCents(order.amountPaidCents)} of {formatCents(order.totalCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
