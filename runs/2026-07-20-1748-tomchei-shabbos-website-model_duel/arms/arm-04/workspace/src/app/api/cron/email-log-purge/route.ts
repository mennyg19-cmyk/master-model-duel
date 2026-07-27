import { runCronJob } from '@/lib/cron/authorize';
import { EMAIL_LOG_PURGE_JOB, purgeDeliveredMessages } from '@/lib/notifications/purge';

export const dynamic = 'force-dynamic';

/**
 * Deletes delivered messages past the retention window (R-172). Bearer secret
 * or 401.
 */
export async function POST(request: Request): Promise<Response> {
  return runCronJob(request, EMAIL_LOG_PURGE_JOB, () => purgeDeliveredMessages());
}

/** The scheduler only issues GET; the gate is the same one. See `authorize.ts`. */
export const GET = POST;
