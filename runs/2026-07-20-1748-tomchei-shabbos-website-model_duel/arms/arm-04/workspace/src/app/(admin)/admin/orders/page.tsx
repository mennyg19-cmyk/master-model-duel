import Link from 'next/link';

import { bulkAction } from './actions';
import { ListSearch, Pagination } from '@/components/admin/list-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { FlashMessages } from '@/components/ui/flash';
import { requirePermission } from '@/lib/auth/staff';
import { pageQueryString, readPageRequest } from '@/lib/admin/list-query';
import { formatCents } from '@/lib/core/money';
import { formatDateTime } from '@/lib/core/dates';
import { MAX_BULK_ORDERS } from '@/lib/orders/bulk-actions';
import { humanizeStatus, orderStatusTone, paymentStatusTone } from '@/lib/orders/order-labels';
import {
  ORDER_DESK_PAYMENTS,
  ORDER_DESK_STATUSES,
  countOrdersByStatus,
  listOrderDesk,
  readOrderDeskFilters,
} from '@/lib/orders/order-desk';

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/orders';

type DeskParams = {
  q?: string;
  status?: string;
  payment?: string;
  page?: string;
  size?: string;
  notice?: string;
  problem?: string;
};

/**
 * The order desk (R-052, R-105).
 *
 * One search box that takes whatever the caller says — a number, a name, an
 * email, a draft reference — because staff on the phone do not know which of
 * those they are holding. Everything below it is a bounded page: the list is
 * built for the Purim morning where a thousand orders are behind it (G-024).
 */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<DeskParams>;
}) {
  const [params, context] = await Promise.all([searchParams, requirePermission('orders.view')]);

  const filters = readOrderDeskFilters(params);
  const request = readPageRequest(params);

  const [{ rows, page }, statusCounts] = await Promise.all([
    listOrderDesk(filters, request),
    countOrdersByStatus(filters),
  ]);

  const canManage = context.permissions.includes('orders.manage');
  const query = {
    q: filters.search,
    status: filters.status ?? '',
    payment: filters.payment ?? '',
    size: String(request.pageSize),
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Orders</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Search by order number, draft reference, name or email.
        </p>
      </header>

      <FlashMessages notice={params.notice} problem={params.problem} testIdPrefix="desk" />

      <ListSearch
        action={BASE_PATH}
        query={filters.search}
        placeholder="#1024, D-XXXX-XXXX, name or email"
        pageSize={request.pageSize}
        filters={[
          {
            name: 'status',
            label: 'Status',
            value: filters.status ?? '',
            choices: [
              { value: '', label: 'Placed and beyond' },
              ...ORDER_DESK_STATUSES.map((status) => ({
                value: status,
                label: `${humanizeStatus(status)} (${statusCounts[status]})`,
              })),
            ],
          },
          {
            name: 'payment',
            label: 'Payment',
            value: filters.payment ?? '',
            choices: [
              { value: '', label: 'Any' },
              ...ORDER_DESK_PAYMENTS.map((payment) => ({
                value: payment,
                label: humanizeStatus(payment),
              })),
            ],
          },
        ]}
      />

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-muted)]" data-testid="desk-empty">
          No order matches that.
        </p>
      ) : (
        <form action={bulkAction} className="space-y-4">
          <input type="hidden" name="returnTo" value={pageQueryString(query, page.page)} />

          <table className="w-full text-sm" data-testid="order-table">
            <thead className="text-left text-[var(--color-ink-muted)]">
              <tr>
                {canManage ? <th className="w-8 py-2" aria-label="Select" /> : null}
                <th className="py-2">Order</th>
                <th>Customer</th>
                <th>Placed</th>
                <th>Status</th>
                <th>Payment</th>
                <th className="text-right">Total</th>
                <th className="text-right">Paid</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr
                  key={order.id}
                  className="border-t border-[var(--color-line)]"
                  data-testid="order-row"
                  data-order-id={order.id}
                  data-payment-status={order.paymentStatus}
                >
                  {canManage ? (
                    <td className="py-2">
                      <input
                        type="checkbox"
                        name="orderIds"
                        value={order.id}
                        aria-label={`Select ${order.orderNumber ?? order.draftReference}`}
                      />
                    </td>
                  ) : null}
                  <td className="py-2">
                    <Link
                      href={`${BASE_PATH}/${order.id}`}
                      className="text-[var(--color-brand)] underline underline-offset-4"
                    >
                      {order.orderNumber === null ? order.draftReference : `#${order.orderNumber}`}
                    </Link>
                  </td>
                  <td>{order.customerName}</td>
                  <td className="text-[var(--color-ink-muted)]">
                    {order.placedAt ? formatDateTime(order.placedAt) : '—'}
                  </td>
                  <td>
                    <Badge tone={orderStatusTone(order.status)}>{order.status}</Badge>
                  </td>
                  <td>
                    <Badge tone={paymentStatusTone(order.paymentStatus)}>
                      {humanizeStatus(order.paymentStatus)}
                    </Badge>
                  </td>
                  <td className="text-right">{formatCents(order.totalCents)}</td>
                  <td className="text-right">{formatCents(order.amountPaidCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {canManage ? (
            <div
              className="flex flex-wrap items-center gap-3 rounded-md bg-[var(--color-surface-muted)] p-3"
              data-testid="bulk-bar"
            >
              <span className="text-sm">With the selected orders:</span>
              <Select name="action" className="w-56" defaultValue="IN_FULFILLMENT">
                <option value="IN_FULFILLMENT">Move into fulfillment</option>
                <option value="COMPLETED">Mark completed</option>
                <option value="CANCELLED">Cancel (unpaid only)</option>
                <option value="REPEAT">Start a repeat order</option>
              </Select>
              <Button type="submit" variant="secondary" data-testid="bulk-apply">
                Apply to selected
              </Button>
              <span className="text-xs text-[var(--color-ink-muted)]">
                Up to {MAX_BULK_ORDERS} at a time. Every order is reported on individually.
              </span>
            </div>
          ) : null}
        </form>
      )}

      <Pagination page={page} basePath={BASE_PATH} query={query} />
    </div>
  );
}
