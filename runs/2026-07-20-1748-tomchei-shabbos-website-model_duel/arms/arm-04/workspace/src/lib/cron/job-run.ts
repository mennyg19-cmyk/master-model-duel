import 'server-only';

import type { Prisma } from '@prisma/client';

import { firstErrorMessage } from '../core/errors';
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
        detail: { message: firstErrorMessage(error) },
      },
    });

    throw error;
  }
}
