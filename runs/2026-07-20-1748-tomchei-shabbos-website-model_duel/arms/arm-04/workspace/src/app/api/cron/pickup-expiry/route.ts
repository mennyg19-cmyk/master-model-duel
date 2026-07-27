import { runCronJob } from '@/lib/cron/authorize';
import { expireUnclaimedPickups, PICKUP_EXPIRY_JOB } from '@/lib/pickup/pickup-service';

export const dynamic = 'force-dynamic';

/**
 * Stamps pickup boxes nobody came for (R-182). Bearer secret or 401.
 *
 * POST only. The job changes rows, and a GET is the one verb a browser, a link
 * preview or a crawler will follow on its own.
 */
export async function POST(request: Request): Promise<Response> {
  return runCronJob(request, PICKUP_EXPIRY_JOB, () => expireUnclaimedPickups());
}
