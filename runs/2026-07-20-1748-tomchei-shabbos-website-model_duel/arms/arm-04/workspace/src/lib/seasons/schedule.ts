import 'server-only';

import type { Prisma, Season, SeasonStatus } from '@prisma/client';

import { recordAudit } from '../audit';
import type { StaffContext } from '../auth/staff';
import { failure, ok, type Result } from '../core/result';
import { wallClockToUtc } from '../core/timezone';
import { runCronJobBody } from '../cron/job-run';
import { db } from '../db';
import { readSetting } from '../settings';
import { SEASON_NOT_FOUND } from './management';

/**
 * The season calendar (UR-008).
 *
 * A manager can flip a season by hand at any time; filling in a date instead
 * says "do it for me at this moment", which is what stops somebody having to be
 * awake at midnight on the first of Adar. The two are the same switch — the
 * sweep just presses it.
 */
export const SEASON_FLIP_JOB = 'season.scheduled-flip';
export const INVALID_SCHEDULE = 'invalid_schedule';

export type SeasonFlipSummary = { opened: number; closed: number };

/**
 * Opens and closes the seasons whose scheduled time has passed.
 *
 * **This function authenticates nobody.** It is the job body, not the endpoint:
 * `/api/cron/season-flip` rejects a request without the bearer secret before
 * calling, because opening a season early puts the store live.
 */
export async function applyScheduledSeasonFlips(now: Date = new Date()): Promise<SeasonFlipSummary> {
  return runCronJobBody(SEASON_FLIP_JOB, async () => {
    // One transaction: a failure between the sweeps would otherwise leave the
    // season list half-flipped behind a run row that reads FAILED.
    const summary = await db.$transaction(async (tx) => {
      const [open, due] = await Promise.all([
        tx.season.findMany({
          where: { status: 'OPEN' },
          select: { id: true, year: true, closesAt: true },
        }),
        tx.season.findMany({
          where: {
            status: 'CLOSED',
            opensAt: { lte: now },
            OR: [{ closesAt: null }, { closesAt: { gt: now } }],
          },
          orderBy: { year: 'desc' },
          select: { id: true, year: true },
        }),
      ]);

      const overdue = open.filter((season) => season.closesAt !== null && season.closesAt <= now);
      const promised = open.filter((season) => season.closesAt !== null && season.closesAt > now);

      // Two seasons open at once would give the storefront two catalogues, so a
      // sweep that finds several due opens the newest and leaves the rest for a
      // manager to look at. A closing date the manager typed is the same kind of
      // instruction, so an opening that could only happen by closing a season
      // early waits for them too rather than overruling the calendar.
      const opening = promised.length === 0 ? due.slice(0, 1) : [];

      // A season left on the hand-worked switch has no date saying when it ends,
      // and the season now due to open is what says so.
      const superseded = opening.length === 0 ? [] : open.filter((season) => season.closesAt === null);

      const closing = [...overdue, ...superseded];
      await flipSeasons(tx, closing, 'CLOSED');
      await flipSeasons(tx, opening, 'OPEN');

      return { opened: opening.length, closed: closing.length };
    });

    return {
      value: summary,
      itemsProcessed: summary.opened + summary.closed,
      detail: summary,
    };
  });
}

/**
 * The sweep pressing the switch, one season at a time.
 *
 * Each flip is its own `season.status_changed` row with `scheduled: true`,
 * because UR-008 treats the calendar and the manual switch as the same act and
 * a `CronRunLog` count cannot say which season moved.
 */
async function flipSeasons(
  tx: Prisma.TransactionClient,
  seasons: { id: string; year: number }[],
  to: SeasonStatus,
): Promise<void> {
  for (const season of seasons) {
    await tx.season.update({ where: { id: season.id }, data: { status: to } });
    await recordAudit(
      null,
      {
        action: 'season.status_changed',
        entityType: 'Season',
        entityId: season.id,
        detail: { year: season.year, to, scheduled: true },
      },
      tx,
    );
  }
}

/**
 * Saves the calendar for one season, reading the two fields as wall-clock times
 * in the office's own timezone. A blank field clears that half of the schedule
 * and hands the switch back to the manager.
 */
export async function setSeasonSchedule(
  staff: StaffContext,
  input: { seasonId: string; opensAt: string; closesAt: string },
): Promise<Result<Season>> {
  const timeZone = await readSetting('store.timezone');

  const opensAt = input.opensAt.trim() === '' ? null : wallClockToUtc(input.opensAt, timeZone);
  const closesAt = input.closesAt.trim() === '' ? null : wallClockToUtc(input.closesAt, timeZone);

  if (input.opensAt.trim() !== '' && opensAt === null) {
    return failure(INVALID_SCHEDULE, `The opening date and time is not a date and time: "${input.opensAt}".`);
  }
  if (input.closesAt.trim() !== '' && closesAt === null) {
    return failure(INVALID_SCHEDULE, `The closing date and time is not a date and time: "${input.closesAt}".`);
  }
  if (opensAt && closesAt && closesAt <= opensAt) {
    return failure(INVALID_SCHEDULE, 'A season cannot close before it opens.');
  }

  // Read before write: a stale id off a calendar somebody left open is a
  // manager's problem to be told about, not a P2025 out of the driver.
  const existing = await db.season.findUnique({ where: { id: input.seasonId }, select: { id: true } });
  if (!existing) return failure(SEASON_NOT_FOUND, 'That season no longer exists.');

  const season = await db.season.update({
    where: { id: input.seasonId },
    data: { opensAt, closesAt },
  });

  await recordAudit(staff, {
    action: 'season.schedule_changed',
    entityType: 'Season',
    entityId: season.id,
    detail: {
      year: season.year,
      opensAt: opensAt?.toISOString() ?? null,
      closesAt: closesAt?.toISOString() ?? null,
    },
  });

  return ok(season);
}
