import { runCronJob } from '@/lib/cron/authorize';
import { applyScheduledSeasonFlips, SEASON_FLIP_JOB } from '@/lib/seasons/schedule';

export const dynamic = 'force-dynamic';

/**
 * Opens and closes seasons whose scheduled moment has passed (UR-008). Bearer
 * secret or 401 — this endpoint can put the shop live.
 *
 * POST only, like every other job: a GET is the one verb a browser, a link
 * preview or a crawler will follow on its own.
 */
export async function POST(request: Request): Promise<Response> {
  return runCronJob(request, SEASON_FLIP_JOB, () => applyScheduledSeasonFlips());
}
