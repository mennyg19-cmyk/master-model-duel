import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  changeOrderStatusAction,
  postOfflinePaymentAction,
  refundPaymentAction,
  repeatOrderAction,
  voidPaymentAction,
} from '../actions';
import { reprintOrderAction } from '../../fulfillment/actions';
import { BackLink } from '@/components/admin/list-controls';
import { OrderPrintLinks } from '@/components/admin/order-print-links';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/field';
import { FlashMessages } from '@/components/ui/flash';
import { requirePermission } from '@/lib/auth/staff';
import { formatCents } from '@/lib/core/money';
import { humanizeStatus, orderStatusTone, paymentStatusTone } from '@/lib/orders/order-labels';
import {
  readStaffOrderBoxes,
  readStaffOrderMoney,
  type StaffOrderBox,
  type StaffPaymentRow,
} from '@/lib/orders/staff-orders';
import { OFFLINE_METHOD_LABELS } from '@/lib/payments/offline-payments';
import { packagePath } from '@/lib/print/paths';
import { PRINTABLE_ORDER_STATUSES } from '@/lib/print/print-data';

export const dynamic = 'force-dynamic';

/**
 * The money desk for one order (UR-011, R-053, R-054).
 *
 * Viewing is `orders.view`; every form here is `orders.manage` and re-checked
 * server-side, so a member of staff who can read an order still cannot take a
 * payment against it. Cash and checks are entered by staff only — the storefront
 * has no route that reaches this — which is the whole of R-127.
 */
export default async function AdminOrderMoneyPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ notice?: string; problem?: string }>;
}) {
  const [{ orderId }, query, staff] = await Promise.all([
    params,
    searchParams,
    requirePermission('orders.view'),
  ]);

  const order = await readStaffOrderMoney(orderId);
  if (!order) notFound();

  const boxes = await readStaffOrderBoxes(order.id);
  const canManage = staff.permissions.includes('orders.manage');
  const canPack = staff.permissions.includes('fulfillment.manage');
  const canPrint = canPack && PRINTABLE_ORDER_STATUSES.includes(order.status);
  const outstandingCents = order.totalCents - order.amountPaidCents;

  return (
    <div className="space-y-6" data-testid="admin-order" data-payment-status={order.paymentStatus}>
      <BackLink href="/admin/orders">Orders</BackLink>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {order.orderNumber === null ? order.draftReference : `Order #${order.orderNumber}`}
          </h1>
          <p className="text-sm text-[var(--color-ink-muted)]">
            {order.customerName}
            {order.customerEmail ? ` · ${order.customerEmail}` : ''} · {order.seasonLabel} ·{' '}
            <Badge tone={orderStatusTone(order.status)}>{order.status}</Badge>{' '}
            <Badge tone={paymentStatusTone(order.paymentStatus)}>
              {humanizeStatus(order.paymentStatus)}
            </Badge>
          </p>
        </div>

        {canManage && order.customerEmail ? (
          <form action={repeatOrderAction}>
            <input type="hidden" name="orderId" value={order.id} />
            <Button type="submit" variant="secondary" data-testid="order-repeat">
              Order this again
            </Button>
          </form>
        ) : null}
      </header>

      <FlashMessages notice={query.notice} problem={query.problem} testIdPrefix="order" />

      <Card>
        <CardTitle>What it costs</CardTitle>
        <dl className="mt-3 max-w-sm space-y-1 text-sm">
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
            <dd data-testid="admin-order-total">{formatCents(order.totalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Paid</dt>
            <dd data-testid="admin-order-paid">{formatCents(order.amountPaidCents)}</dd>
          </div>
          <div className="flex justify-between text-[var(--color-ink-muted)]">
            <dt>Outstanding</dt>
            <dd data-testid="admin-order-outstanding">{formatCents(outstandingCents)}</dd>
          </div>
        </dl>

        {order.packageFees.length > 0 ? (
          <>
            <CardDescription className="mt-4">
              Fulfillment charged per box, frozen at checkout. Moving a box to another method later
              does not re-price it.
            </CardDescription>
            <ul className="mt-2 space-y-1 text-sm">
              {order.packageFees.map((row) => (
                <li key={row.id} className="flex justify-between" data-testid="package-fee">
                  <span>
                    {row.recipientName} · {row.methodLabel}
                  </span>
                  <span data-cents={row.feeCents}>{formatCents(row.feeCents)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>

      <section className="space-y-3" data-testid="order-boxes" data-box-count={boxes.length}>
        <h2 className="text-lg font-semibold">What is in it</h2>
        {boxes.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">
            This order has not been packed into boxes yet.
          </p>
        ) : (
          <>
            {canPrint ? <OrderPaper orderId={order.id} /> : null}
            {canPack && !canPrint ? (
              <p className="text-sm text-[var(--color-ink-muted)]" data-testid="order-not-printable">
                No paper is filed for this order: it is {order.status.toLowerCase()}, and the
                nightly batch only prints orders that are placed or in fulfillment.
              </p>
            ) : null}
            {boxes.map((box) => (
              <OrderBox key={box.id} box={box} canPack={canPack} />
            ))}
          </>
        )}
      </section>

      <Card>
        <CardTitle>Payments</CardTitle>
        {order.payments.length === 0 ? (
          <CardDescription>Nothing has been paid against this order yet.</CardDescription>
        ) : (
          <ul className="mt-3 space-y-3">
            {order.payments.map((payment) => (
              <PaymentRow
                key={payment.id}
                payment={payment}
                orderId={order.id}
                canManage={canManage}
              />
            ))}
          </ul>
        )}
      </Card>

      {canManage ? (
        <Card data-testid="pos-panel">
          <CardTitle>Take a cash or check payment</CardTitle>
          <CardDescription>
            Staff only, and recorded against your name. Card payments arrive from the payment
            provider and are never entered by hand.
          </CardDescription>

          <form action={postOfflinePaymentAction} className="mt-4 grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="orderId" value={order.id} />

            <div>
              <Label htmlFor="method">Method</Label>
              <Select id="method" name="method" defaultValue="CASH">
                <option value="CASH">Cash</option>
                <option value="CHECK">Check</option>
              </Select>
            </div>

            <div>
              <Label htmlFor="amount">Amount (dollars)</Label>
              <Input
                id="amount"
                name="amount"
                inputMode="decimal"
                defaultValue={(Math.max(outstandingCents, 0) / 100).toFixed(2)}
              />
            </div>

            <div>
              <Label htmlFor="reference">Check number or receipt</Label>
              <Input id="reference" name="reference" />
            </div>

            <div className="flex items-end">
              <Button type="submit" data-testid="pos-post">
                Record payment
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {canManage && order.status !== 'CANCELLED' ? (
        <Card>
          <CardTitle>Move this order</CardTitle>
          <CardDescription>
            Cancelling releases the stock this order is holding back to the shelf.
          </CardDescription>

          <form action={changeOrderStatusAction} className="mt-3 flex items-end gap-3">
            <input type="hidden" name="orderId" value={order.id} />
            <div>
              <Label htmlFor="status">New status</Label>
              <Select id="status" name="status" defaultValue="IN_FULFILLMENT">
                <option value="IN_FULFILLMENT">In fulfillment</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </Select>
            </div>
            <Button type="submit" variant="secondary" data-testid="order-transition">
              Move
            </Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * R-056. This order's paper without waiting for tonight's batch, plus a reprint
 * that files it the way the nightly run would. Neither moves a box along.
 */
function OrderPaper({ orderId }: { orderId: string }) {
  return (
    <div
      className="flex flex-wrap items-center gap-4 rounded-md bg-[var(--color-surface-muted)] p-3 text-sm"
      data-testid="order-paper"
    >
      <span>Print:</span>
      <OrderPrintLinks orderId={orderId} />

      <form action={reprintOrderAction}>
        <input type="hidden" name="orderId" value={orderId} />
        <Button type="submit" variant="secondary" data-testid="order-reprint">
          File a reprint batch
        </Button>
      </form>
    </div>
  );
}

function OrderBox({ box, canPack }: { box: StaffOrderBox; canPack: boolean }) {
  return (
    <Card data-testid="order-box" data-stage={box.stage}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle>
          {canPack ? (
            <Link href={packagePath(box.id)} className="underline underline-offset-4">
              {box.recipientName}
            </Link>
          ) : (
            box.recipientName
          )}
        </CardTitle>
        <Badge tone="neutral">{box.stage}</Badge>
      </div>

      <CardDescription>
        {box.methodLabel} · {box.destination}
        {box.deliveryDay ? ` · ${box.deliveryDay}` : ''}
      </CardDescription>

      <ul className="mt-3 space-y-1 text-sm">
        {box.lines.map((line) => (
          <li key={line.id} className="flex justify-between gap-4">
            <span>
              {line.quantity} × {line.name}
              {line.options ? ` (${line.options})` : ''}
              {line.addOns.length > 0 ? ` + ${line.addOns.join(', ')}` : ''}
            </span>
            <span>{formatCents(line.totalCents)}</span>
          </li>
        ))}
      </ul>

      {box.greetingMessage ? (
        <p className="mt-3 border-l-2 border-[var(--color-line)] pl-3 text-sm italic">
          {box.greetingMessage}
        </p>
      ) : null}
    </Card>
  );
}

function PaymentRow({
  payment,
  orderId,
  canManage,
}: {
  payment: StaffPaymentRow;
  orderId: string;
  canManage: boolean;
}) {
  const refundable = payment.amountCents - payment.refundedCents;
  const isOpen = payment.state === 'POSTED';

  return (
    <li
      className="rounded-md border border-[var(--color-line)] p-3 text-sm"
      data-testid="payment-row"
      data-method={payment.method}
      data-state={payment.state}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {OFFLINE_METHOD_LABELS[payment.method]} · {formatCents(payment.amountCents)}
          {payment.refundedCents > 0 ? ` · ${formatCents(payment.refundedCents)} refunded` : ''}
        </span>
        <span className="text-[var(--color-ink-muted)]">
          {payment.receivedAt.toLocaleDateString('en-US')}
          {payment.recordedBy ? ` · ${payment.recordedBy}` : ' · provider'}
          {payment.reference ? ` · ${payment.reference}` : ''}
        </span>
      </div>

      {payment.state === 'VOIDED' ? (
        <p className="mt-1 text-[var(--color-ink-muted)]">Voided — {payment.voidReason}</p>
      ) : null}

      {canManage && isOpen ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <form action={voidPaymentAction} className="flex items-end gap-2">
            <input type="hidden" name="orderId" value={orderId} />
            <input type="hidden" name="paymentId" value={payment.id} />
            <div className="grow">
              <Label htmlFor={`void-${payment.id}`}>Void because</Label>
              <Input id={`void-${payment.id}`} name="reason" placeholder="Keyed twice" />
            </div>
            <Button type="submit" variant="secondary" data-testid="payment-void">
              Void
            </Button>
          </form>

          {refundable > 0 ? (
            <form action={refundPaymentAction} className="flex items-end gap-2">
              <input type="hidden" name="orderId" value={orderId} />
              <input type="hidden" name="paymentId" value={payment.id} />
              <div>
                <Label htmlFor={`refund-amount-${payment.id}`}>Refund (dollars)</Label>
                <Input
                  id={`refund-amount-${payment.id}`}
                  name="amount"
                  inputMode="decimal"
                  defaultValue={(refundable / 100).toFixed(2)}
                />
              </div>
              <div className="grow">
                <Label htmlFor={`refund-reason-${payment.id}`}>Because</Label>
                <Input id={`refund-reason-${payment.id}`} name="reason" placeholder="Order cancelled" />
              </div>
              <Button type="submit" variant="secondary" data-testid="payment-refund">
                Refund
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
