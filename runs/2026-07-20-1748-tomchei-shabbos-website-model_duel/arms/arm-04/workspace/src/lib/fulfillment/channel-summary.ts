import 'server-only';

import type { FulfillmentKind, PackageStage, Prisma } from '@prisma/client';

import { db } from '../db';

/**
 * The fulfillment channel dashboard (R-072, R-073).
 *
 * A channel is a fulfillment method: shipping, volunteer delivery, the bulk run,
 * the pickup counter. The office works them separately — different people,
 * different days — so the numbers are per channel first and per season second.
 *
 * **Production** is how much there is to make and move: boxes and items, and how
 * far along each box is.
 *
 * **Savings** is what grouping saved on the bulk run (UR-009). A box on a
 * per-destination method would have cost the method's base fee on its own; what
 * it actually cost is frozen on the package. The difference is the drive that
 * did not have to be made, and it is read from the charged snapshots rather than
 * recomputed, so the dashboard can never disagree with what the customer paid.
 */
export type ChannelSummary = {
  methodId: string;
  code: string;
  label: string;
  kind: FulfillmentKind;
  packageCount: number;
  itemCount: number;
  stageCounts: Record<PackageStage, number>;
  chargedCents: number;
  savedCents: number;
};

export type FulfillmentTotals = {
  packageCount: number;
  itemCount: number;
  chargedCents: number;
  savedCents: number;
  stageCounts: Record<PackageStage, number>;
};

/** Boxes on orders the office is actually working. Cancelled orders are not made. */
export function boardScopeWhere(seasonId: string): Prisma.PackageWhereInput {
  return { order: { seasonId, status: { in: ['PLACED', 'IN_FULFILLMENT', 'COMPLETED'] } } };
}

export const ALL_STAGES: PackageStage[] = ['NEW', 'PRINTED', 'PACKED', 'SENT', 'PICKED_UP'];

export function emptyStageCounts(): Record<PackageStage, number> {
  return { NEW: 0, PRINTED: 0, PACKED: 0, SENT: 0, PICKED_UP: 0 };
}

export async function readChannelSummaries(
  seasonId: string,
): Promise<{ channels: ChannelSummary[]; totals: FulfillmentTotals }> {
  const where = boardScopeWhere(seasonId);

  const [methods, byMethod, byStage, items] = await Promise.all([
    db.fulfillmentMethod.findMany({ orderBy: { sortOrder: 'asc' } }),
    db.package.groupBy({
      by: ['fulfillmentMethodId'],
      where,
      _count: { _all: true },
      _sum: { fulfillmentFeeCents: true },
    }),
    db.package.groupBy({ by: ['fulfillmentMethodId', 'stage'], where, _count: { _all: true } }),
    db.orderLine.groupBy({
      by: ['fulfillmentMethodId'],
      where: { packageId: { not: null }, package: where },
      _sum: { quantity: true },
    }),
  ]);

  const counted = new Map(byMethod.map((row) => [row.fulfillmentMethodId, row]));
  const itemsByMethod = new Map(items.map((row) => [row.fulfillmentMethodId, row._sum.quantity ?? 0]));

  const channels = methods.map((method): ChannelSummary => {
    const totals = counted.get(method.id);
    const packageCount = totals?._count._all ?? 0;
    const chargedCents = totals?._sum.fulfillmentFeeCents ?? 0;

    return {
      methodId: method.id,
      code: method.code,
      label: method.label,
      kind: method.kind,
      packageCount,
      itemCount: itemsByMethod.get(method.id) ?? 0,
      stageCounts: stageCountsFor(byStage, method.id),
      chargedCents,
      savedCents:
        method.feeBasis === 'PER_DESTINATION'
          ? Math.max(packageCount * method.baseFeeCents - chargedCents, 0)
          : 0,
    };
  });

  return { channels, totals: sumChannels(channels) };
}

type StageGroup = { fulfillmentMethodId: string; stage: PackageStage; _count: { _all: number } };

function stageCountsFor(rows: StageGroup[], methodId: string): Record<PackageStage, number> {
  const counts = emptyStageCounts();

  for (const row of rows) {
    if (row.fulfillmentMethodId === methodId) counts[row.stage] = row._count._all;
  }

  return counts;
}

function sumChannels(channels: ChannelSummary[]): FulfillmentTotals {
  const stageCounts = emptyStageCounts();

  for (const channel of channels) {
    for (const stage of ALL_STAGES) stageCounts[stage] += channel.stageCounts[stage];
  }

  return {
    packageCount: channels.reduce((total, channel) => total + channel.packageCount, 0),
    itemCount: channels.reduce((total, channel) => total + channel.itemCount, 0),
    chargedCents: channels.reduce((total, channel) => total + channel.chargedCents, 0),
    savedCents: channels.reduce((total, channel) => total + channel.savedCents, 0),
    stageCounts,
  };
}
