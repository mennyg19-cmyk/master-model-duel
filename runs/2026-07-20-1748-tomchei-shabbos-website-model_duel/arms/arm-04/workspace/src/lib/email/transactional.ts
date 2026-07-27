import 'server-only';

import type { DbClient } from '../core/db-client';
import { formatCents } from '../core/money';
import { db } from '../db';
import { env } from '../env';
import { queueMessage, type OutboxResult, EMPTY_OUTBOX_RESULT } from '../notifications/outbox';
import { formatOrderLabel } from '../orders/order-labels';
import { renderTriggeredEmail, type TriggeredTemplateKey } from './templates';

/**
 * The three emails an order sends on its own (R-087).
 *
 * Each one is queued into the same outbox P9 writes to, so the transport, the
 * retry rule and the audit trail are the ones already built rather than three
 * new ones. Each has a dedupe key naming the event it belongs to, which is why
 * a second checkout attempt, a replayed webhook or a rerun sweep cannot mail a
 * customer the same confirmation twice.
 *
 * A customer with no email address on file is skipped rather than invented for:
 * `queueMessage` counts that as `skipped`, which is the honest answer for an
 * order taken over the counter from somebody who has never given one.
 */
export type OrderEmailContext = {
  id: string;
  orderNumber: number | null;
  draftReference: string;
  customerId: string | null;
};

export async function queueOrderConfirmation(
  order: OrderEmailContext,
  packageCount: number,
  totalCents: number,
  client: DbClient = db,
): Promise<OutboxResult> {
  const customer = await readCustomer(order.customerId, client);
  if (!customer) return { ...EMPTY_OUTBOX_RESULT, skipped: 1 };

  return queueOrderEmail(
    'order.confirmation',
    { order, customer, dedupeKey: `order.confirmation:${order.id}` },
    {
      total: formatCents(totalCents),
      packageCount: `${packageCount} ${packageCount === 1 ? 'box' : 'boxes'}`,
      orderUrl: absoluteUrl(`/account/orders/${order.id}`),
    },
    client,
  );
}

/**
 * The link to a hosted payment page. Keyed by the session rather than by the
 * order, because resuming a payment opens a genuinely new page and mailing the
 * dead one would send the customer somewhere that no longer works.
 */
export async function queuePaymentLink(
  order: OrderEmailContext,
  input: { sessionId: string; amountDueCents: number; paymentUrl: string },
  client: DbClient = db,
): Promise<OutboxResult> {
  const customer = await readCustomer(order.customerId, client);
  if (!customer) return { ...EMPTY_OUTBOX_RESULT, skipped: 1 };

  return queueOrderEmail(
    'order.payment_link',
    { order, customer, dedupeKey: `order.payment_link:${input.sessionId}` },
    { amountDue: formatCents(input.amountDueCents), paymentUrl: input.paymentUrl },
    client,
  );
}

/**
 * Money going back, whoever sent it back: the counter, the office refunding a
 * card, or the provider's own dashboard arriving as a webhook. All three call
 * this, so a customer is told the same thing however the refund happened.
 */
export async function queueRefundNotice(
  orderId: string,
  input: { refundId: string; amountCents: number; reason: string },
  client: DbClient = db,
): Promise<OutboxResult> {
  const order = await client.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, draftReference: true, customerId: true },
  });
  if (!order) return { ...EMPTY_OUTBOX_RESULT, skipped: 1 };

  const customer = await readCustomer(order.customerId, client);
  if (!customer) return { ...EMPTY_OUTBOX_RESULT, skipped: 1 };

  return queueOrderEmail(
    'order.refund',
    { order, customer, dedupeKey: `order.refund:${input.refundId}` },
    { amountRefunded: formatCents(input.amountCents), reason: input.reason },
    client,
  );
}

type OrderEmailCustomer = { id: string; fullName: string; email: string };

async function queueOrderEmail(
  key: TriggeredTemplateKey,
  target: { order: OrderEmailContext; customer: OrderEmailCustomer; dedupeKey: string },
  variables: Record<string, string>,
  client: DbClient,
): Promise<OutboxResult> {
  const rendered = await renderTriggeredEmail(
    key,
    {
      customerName: target.customer.fullName,
      orderLabel: formatOrderLabel(target.order).toLowerCase(),
      ...variables,
    },
    client,
  );

  // The office switched this message off, which is a decision rather than a
  // failure: nothing is queued and nothing is counted as skipped mail.
  if (!rendered) return EMPTY_OUTBOX_RESULT;

  return queueMessage(
    {
      channel: 'EMAIL',
      kind: key,
      destination: target.customer.email,
      subject: rendered.subject,
      body: rendered.body,
      dedupeKey: target.dedupeKey,
      customerId: target.customer.id,
      orderId: target.order.id,
    },
    client,
  );
}

async function readCustomer(
  customerId: string | null,
  client: DbClient,
): Promise<OrderEmailCustomer | null> {
  if (!customerId) return null;

  return client.customer.findUnique({
    where: { id: customerId },
    select: { id: true, fullName: true, email: true },
  });
}

function absoluteUrl(path: string): string {
  return new URL(path, env.APP_URL).toString();
}
