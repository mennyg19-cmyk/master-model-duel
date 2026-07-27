import 'server-only';

import { formatCents } from '../core/money';
import { runCronJobBody } from '../cron/job-run';
import { db } from '../db';
import { addResults, EMPTY_OUTBOX_RESULT, queueCustomerMessage, type OutboxResult } from '../notifications/outbox';
import { formatOrderLabel } from '../orders/order-labels';
import { readSetting } from '../settings';

/**
 * The payment reminder sweep (R-080).
 *
 * An order that has been placed for longer than the office's follow-up window
 * and still owes money gets one reminder a day — the dedupe key carries the
 * date, so a cron that fires twice at midnight sends one message and a genuine
 * second day sends a second.
 *
 * **This function authenticates nobody.** It is the job body; the route that
 * calls it checks the bearer secret first.
 */
export const PAYMENT_REMINDER_JOB = 'payment.reminder-sweep';

export type PaymentReminderSummary = { orders: number; outbox: OutboxResult };

export async function sendPaymentReminders(now: Date = new Date()): Promise<PaymentReminderSummary> {
  return runCronJobBody(PAYMENT_REMINDER_JOB, async () => {
    const followUpDays = await readSetting('orders.followUpDays');
    const olderThan = new Date(now.getTime() - followUpDays * 24 * 60 * 60 * 1000);
    const day = now.toISOString().slice(0, 10);

    const orders = await db.order.findMany({
      where: {
        status: { in: ['PLACED', 'IN_FULFILLMENT'] },
        paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] },
        placedAt: { lte: olderThan },
      },
      include: { customer: { select: { id: true, email: true, normalizedPhone: true } } },
    });

    let outbox = EMPTY_OUTBOX_RESULT;

    for (const order of orders) {
      if (!order.customer) continue;

      const owed = Math.max(order.totalCents - order.amountPaidCents, 0);
      if (owed === 0) continue;

      const label = formatOrderLabel(order);

      outbox = addResults(
        outbox,
        await queueCustomerMessage({
          kind: 'payment.reminder',
          dedupeKey: `payment.reminder:${order.id}:${day}`,
          email: order.customer.email,
          phone: order.customer.normalizedPhone,
          subject: `A reminder about ${label}`,
          body:
            `There is still ${formatCents(owed)} outstanding on ${label}. ` +
            'You can pay online or ring the office — and thank you for giving.',
          customerId: order.customer.id,
          orderId: order.id,
        }),
      );
    }

    return {
      value: { orders: orders.length, outbox },
      itemsProcessed: outbox.queued,
      detail: { orders: orders.length, ...outbox },
    };
  });
}
