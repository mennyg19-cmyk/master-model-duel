import 'server-only';

import type { Season, SeasonStatus } from '@prisma/client';

import { recordAudit } from '../audit';
import type { StaffContext } from '../auth/staff';
import { failure, ok, type Result } from '../core/result';
import { db } from '../db';

/**
 * The Open/Closed switch itself (UR-008).
 *
 * Two seasons open at once would give the storefront two catalogues and the
 * order desk two number sequences, so opening one closes whichever was open.
 * That is the only thing this does implicitly, and it is audited as its own row
 * so the calendar reads honestly afterwards.
 */
export const SEASON_ALREADY = 'season_already';
export const SEASON_NOT_FOUND = 'season_not_found';

export type SeasonRow = Season & {
  productCount: number;
  orderCount: number;
};

/** Newest first, with nothing counted: the shape a picker needs. */
export function listSeasonsNewestFirst(): Promise<Season[]> {
  return db.season.findMany({ orderBy: { year: 'desc' } });
}

export async function listSeasons(): Promise<SeasonRow[]> {
  const rows = await db.season.findMany({
    orderBy: { year: 'desc' },
    include: { _count: { select: { products: true, orders: true } } },
  });

  return rows.map(({ _count, ...season }) => ({
    ...season,
    productCount: _count.products,
    orderCount: _count.orders,
  }));
}

export async function setSeasonStatus(
  staff: StaffContext,
  input: { seasonId: string; to: SeasonStatus },
): Promise<Result<Season>> {
  const season = await db.season.findUnique({ where: { id: input.seasonId } });
  if (!season) return failure(SEASON_NOT_FOUND, 'That season no longer exists.');
  if (season.status === input.to) {
    return failure(SEASON_ALREADY, `${season.label} is already ${input.to.toLowerCase()}.`);
  }

  const flipped = await db.$transaction(async (tx) => {
    if (input.to === 'OPEN') {
      await tx.season.updateMany({
        where: { status: 'OPEN', id: { not: season.id } },
        data: { status: 'CLOSED' },
      });
    }

    return tx.season.update({ where: { id: season.id }, data: { status: input.to } });
  });

  await recordAudit(staff, {
    action: 'season.status_changed',
    entityType: 'Season',
    entityId: flipped.id,
    detail: { year: flipped.year, to: input.to, scheduled: false },
  });

  return ok(flipped);
}
