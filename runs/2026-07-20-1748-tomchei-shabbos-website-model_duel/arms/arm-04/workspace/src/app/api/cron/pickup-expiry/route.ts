import { runCronJob } from '@/lib/cron/authorize';
import { expireUnclaimedPickups, PICKUP_EXPIRY_JOB } from '@/lib/pickup/pickup-service';

export const dynamic = 'force-dynamic';

/** Stamps pickup boxes nobody came for (R-182). Bearer secret or 401. */
export async function POST(request: Request): Promise<Response> {
  return runCronJob(request, PICKUP_EXPIRY_JOB, () => expireUnclaimedPickups());
}

/** The scheduler only issues GET; the gate is the same one. See `authorize.ts`. */
export const GET = POST;
