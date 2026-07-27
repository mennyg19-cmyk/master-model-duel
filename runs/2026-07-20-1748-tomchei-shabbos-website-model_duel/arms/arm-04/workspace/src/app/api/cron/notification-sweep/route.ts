import { runCronJob } from '@/lib/cron/authorize';
import { NOTIFICATION_SWEEP_JOB, sweepNotificationOutbox } from '@/lib/notifications/dispatch';

export const dynamic = 'force-dynamic';

/**
 * Empties the notification outbox (R-088, R-181). Bearer secret or 401.
 *
 * POST only, like the other sweeps: this one actually posts mail, and a GET is
 * the verb a browser, a link preview or a crawler follows on its own.
 */
export async function POST(request: Request): Promise<Response> {
  return runCronJob(request, NOTIFICATION_SWEEP_JOB, () => sweepNotificationOutbox());
}
