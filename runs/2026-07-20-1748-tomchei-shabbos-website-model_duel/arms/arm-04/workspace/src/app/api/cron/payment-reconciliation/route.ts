import { runCronJob } from '@/lib/cron/authorize';
import { PAYMENT_RECONCILIATION_JOB, reconcilePayments } from '@/lib/payments/reconciliation';

export const dynamic = 'force-dynamic';

/**
 * The nightly check that the ledger and the gateway still agree (R-093). Bearer
 * secret or 401. It writes flags and never touches a payment.
 */
export async function POST(request: Request): Promise<Response> {
  return runCronJob(request, PAYMENT_RECONCILIATION_JOB, () =>
    reconcilePayments({ source: 'cron' }),
  );
}

/** Vercel's scheduler calls its crons with GET. */
export const GET = POST;
