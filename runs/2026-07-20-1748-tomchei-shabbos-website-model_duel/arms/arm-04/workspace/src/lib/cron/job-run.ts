import 'server-only';

import type { Prisma } from '@prisma/client';

import { db } from '../db';

/**
 * The `CronRunLog` row every scheduled job leaves behind (R-182).
 *
 * Each job body had grown its own copy of the same twenty-five lines: create
 * the row, do the work, stamp SUCCEEDED, catch, stamp FAILED, rethrow. The
 * copies drifted — one recorded `itemsProcessed`, the other did not — and the
 * HTTP wrapper caught the rethrow and logged it a second time.
 *
 * So the row lives here and the job body only says what it did. A job that
 * throws is recorded as FAILED and rethrown once, for the wrapper to turn into
 * a 500.
 */
export type CronJobOutcome<T> = {
  /** What the caller gets back, and what the endpoint answers with. */
  value: T;
  itemsProcessed: number;
  detail: Prisma.JsonObject;
};

/**
 * A stack trace or a driver error can carry connection strings and row
 * contents. `CronRunLog` is read by staff, so only a short, plain first line
 * of it is kept.
 */
const MAX_DETAIL_MESSAGE_LENGTH = 200;

export async function runCronJobBody<T>(
  jobName: string,
  work: () => Promise<CronJobOutcome<T>>,
): Promise<T> {
  const run = await db.cronRunLog.create({ data: { jobName } });

  try {
    const outcome = await work();

    await db.cronRunLog.update({
      where: { id: run.id },
      data: {
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        itemsProcessed: outcome.itemsProcessed,
        detail: outcome.detail,
      },
    });

    return outcome.value;
  } catch (error) {
    await db.cronRunLog.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        detail: { message: safeMessage(error) },
      },
    });

    throw error;
  }
}

function safeMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';

  return error.message.split('\n')[0].slice(0, MAX_DETAIL_MESSAGE_LENGTH);
}
