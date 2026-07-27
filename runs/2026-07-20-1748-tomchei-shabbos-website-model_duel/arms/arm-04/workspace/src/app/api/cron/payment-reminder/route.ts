import { runCronJob } from '@/lib/cron/authorize';
import { PAYMENT_REMINDER_JOB, sendPaymentReminders } from '@/lib/scheduling/payment-reminder';

export const dynamic = 'force-dynamic';

/** One reminder a day for an order that still owes (R-080). Bearer secret or 401. */
export async function POST(request: Request): Promise<Response> {
  return runCronJob(request, PAYMENT_REMINDER_JOB, async () => {
    const summary = await sendPaymentReminders();
    return { orders: summary.orders, ...summary.outbox };
  });
}

/** The scheduler only issues GET; the gate is the same one. See `authorize.ts`. */
export const GET = POST;
