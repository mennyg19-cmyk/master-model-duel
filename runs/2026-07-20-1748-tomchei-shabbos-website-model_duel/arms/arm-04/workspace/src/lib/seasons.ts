import 'server-only';

import { db } from './db';

export const SEASON_FLIP_JOB = 'season.scheduled-flip';

export type SeasonFlipSummary = { opened: number; closed: number };

/**
 * Opens and closes seasons whose scheduled time has passed (UR-008). Managers
 * can still flip a season by hand; this only moves the ones that asked to be
 * moved by filling in `opensAt` or `closesAt`.
 *
 * Every run writes a `CronRunLog` row (R-163). Without it, a sweeper that
 * quietly stopped running looks exactly like a sweeper with nothing to do.
 *
 * **This function authenticates nobody.** It is the job body, not the endpoint.
 * The route that wires it up in P12 must reject the request before calling —
 * the same bearer-secret check every scheduled job route gets — because opening
 * a season early puts the store live.
 */
export async function applyScheduledSeasonFlips(now: Date = new Date()): Promise<SeasonFlipSummary> {
  const run = await db.cronRunLog.create({ data: { jobName: SEASON_FLIP_JOB } });

  try {
    // One transaction: a failure between the two sweeps would otherwise leave
    // the season list half-flipped behind a run row that reads FAILED.
    const [opened, closed] = await db.$transaction([
      db.season.updateMany({
        where: {
          status: 'CLOSED',
          opensAt: { lte: now },
          OR: [{ closesAt: null }, { closesAt: { gt: now } }],
        },
        data: { status: 'OPEN' },
      }),
      db.season.updateMany({
        where: { status: 'OPEN', closesAt: { lte: now } },
        data: { status: 'CLOSED' },
      }),
    ]);

    await db.cronRunLog.update({
      where: { id: run.id },
      data: {
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        itemsProcessed: opened.count + closed.count,
        detail: { opened: opened.count, closed: closed.count },
      },
    });

    return { opened: opened.count, closed: closed.count };
  } catch (error) {
    // Marked failed and rethrown: the caller still needs to see the error, and
    // a run row stuck on RUNNING would read as "still going" forever.
    await db.cronRunLog.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        detail: { message: error instanceof Error ? error.message : 'unknown error' },
      },
    });

    throw error;
  }
}
