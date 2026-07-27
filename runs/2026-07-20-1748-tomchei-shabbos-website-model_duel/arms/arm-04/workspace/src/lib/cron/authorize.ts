import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';

import { env } from '../env';

/**
 * The gate in front of every scheduled job (R-182).
 *
 * A cron endpoint is a URL on the public internet that opens seasons, expires
 * pickups and mails customers. One rule covers all of them: send the shared
 * secret as a bearer token or get nothing.
 *
 * An unconfigured secret refuses every request rather than letting everybody in.
 * That is the safe reading of "not set up yet", and `env-spec.ts` makes a hosted
 * deployment set one so the refusal cannot become a silent outage nobody notices
 * until pickups stop expiring.
 */
export function cronRequestIsAuthorized(request: Request): boolean {
  const configured = env.CRON_SECRET ?? '';
  if (configured === '') return false;

  const header = request.headers.get('authorization') ?? '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;

  return secretsMatch(header.slice(prefix.length), configured);
}

/** 401 with no body: a caller without the secret learns nothing about the job. */
export function cronUnauthorized(): Response {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/**
 * Runs a job behind the gate and answers with what it did.
 *
 * Auth and HTTP only. The run row, its terminal status and the reason a failure
 * failed are `runCronJobBody`'s job (`job-run.ts`), so a failure is recorded
 * once rather than written to the table and shouted at stderr as well.
 */
export async function runCronJob<T>(
  request: Request,
  jobName: string,
  job: () => Promise<T>,
): Promise<Response> {
  if (!cronRequestIsAuthorized(request)) return cronUnauthorized();

  try {
    return Response.json({ job: jobName, ...(await job()) });
  } catch {
    return new Response('The job failed. See CronRunLog for the run row.', { status: 500 });
  }
}

/**
 * Both sides are hashed first so the comparison is over two 32-byte digests
 * whatever was sent. Comparing the raw strings would return early on a length
 * mismatch, which tells a caller how long the secret is.
 */
function secretsMatch(candidate: string, expected: string): boolean {
  return timingSafeEqual(sha256(candidate), sha256(expected));
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
