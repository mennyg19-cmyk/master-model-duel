import { runCronJob } from '@/lib/cron/authorize';
import { NOTIFICATION_SWEEP_JOB, sweepNotificationOutbox } from '@/lib/notifications/dispatch';

export const dynamic = 'force-dynamic';

/** Empties the notification outbox (R-088, R-181). Bearer secret or 401. */
export async function POST(request: Request): Promise<Response> {
  return runCronJob(request, NOTIFICATION_SWEEP_JOB, () => sweepNotificationOutbox());
}

/** The scheduler only issues GET; the gate is the same one. See `authorize.ts`. */
export const GET = POST;
