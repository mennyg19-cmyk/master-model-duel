import { runCronJob } from '@/lib/cron/authorize';
import { PAYMENT_REMINDER_JOB, sendPaymentReminders } from '@/lib/scheduling/payment-reminder';

export const dynamic = 'force-dynamic';

/**
 * One reminder a day for an order that still owes (R-080). Bearer secret or 401.
 *
 * POST only, for the same reason the pickup sweep is: it sends mail.
 */
export async function POST(request: Request): Promise<Response> {
  return runCronJob(request, PAYMENT_REMINDER_JOB, async () => {
    const summary = await sendPaymentReminders();
    return { orders: summary.orders, ...summary.outbox };
  });
}
