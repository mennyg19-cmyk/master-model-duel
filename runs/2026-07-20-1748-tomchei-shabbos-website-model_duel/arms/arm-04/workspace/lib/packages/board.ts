import type { FulfillmentKind, PackageStage, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// Bounded package board queries (UR-001, G-024): hard take ceiling and a
// deterministic sort, same discipline as lib/orders/list.ts.

export const PACKAGES_PAGE_SIZE = 50;
const MAX_PAGE = 200;

const STAGES: PackageStage[] = ["NEW", "PRINTED", "PACKED", "SENT", "PICKED_UP"];

export type PackageListFilters = {
  q: string;
  stage: PackageStage | null;
  methodId: string | null;
  page: number;
};

export function parsePackageListFilters(params: {
  q?: string;
  stage?: string;
  method?: string;
  page?: string;
}): PackageListFilters {
  const page = Math.min(MAX_PAGE, Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1));
  return {
    q: (params.q ?? "").trim().slice(0, 100),
    stage: STAGES.find((value) => value === params.stage) ?? null,
    methodId: (params.method ?? "").trim() || null,
    page,
  };
}

export async function listPackages(seasonId: string, filters: PackageListFilters) {
  const where: Prisma.PackageWhereInput = {
    seasonId,
    // Emptied regroup sources stay in the DB for their audit trail but are not
    // physical boxes anymore — keep them off the working board.
    lines: { some: {} },
  };
  if (filters.stage) where.stage = filters.stage;
  if (filters.methodId) where.fulfillmentMethodId = filters.methodId;
  if (filters.q) {
    where.OR = [
      { recipientName: { contains: filters.q, mode: "insensitive" } },
      { addressLine1: { contains: filters.q, mode: "insensitive" } },
      { city: { contains: filters.q, mode: "insensitive" } },
    ];
  }

  const [total, packages] = await Promise.all([
    db.package.count({ where }),
    db.package.findMany({
      where,
      include: {
        fulfillmentMethod: { select: { id: true, code: true, name: true, kind: true } },
        // Latest label attempt drives the board's shipment controls (P8).
        shipments: { orderBy: { createdAt: "desc" }, take: 1 },
        lines: {
          select: {
            id: true,
            quantity: true,
            product: { select: { name: true } },
            order: { select: { id: true, orderNumber: true, draftReference: true } },
            addOns: { select: { id: true } },
          },
          orderBy: { id: "asc" },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * PACKAGES_PAGE_SIZE,
      take: PACKAGES_PAGE_SIZE,
    }),
  ]);
  return { total, packages, pageCount: Math.max(1, Math.ceil(total / PACKAGES_PAGE_SIZE)) };
}

export type ChannelSummary = {
  methodId: string;
  code: string;
  name: string;
  kind: FulfillmentKind;
  stageCounts: Record<PackageStage, number>;
  packages: number;
  gifts: number;
  /** Boxes NOT sent thanks to grouping: gift lines merged beyond one per package. */
  groupingSavings: number;
};

/** Per-channel production + savings rollup (R-072, R-073), grouped in SQL. */
export async function channelSummaries(seasonId: string): Promise<ChannelSummary[]> {
  const [methods, stageGroups, lineGroups] = await Promise.all([
    db.fulfillmentMethod.findMany({ orderBy: { sortOrder: "asc" } }),
    db.package.groupBy({
      by: ["fulfillmentMethodId", "stage"],
      where: { seasonId, lines: { some: {} } },
      _count: { _all: true },
    }),
    db.orderLine.groupBy({
      by: ["fulfillmentMethodId"],
      where: { package: { seasonId, lines: { some: {} } } },
      _count: { _all: true },
    }),
  ]);

  const summaries = new Map<string, ChannelSummary>();
  for (const method of methods) {
    summaries.set(method.id, {
      methodId: method.id,
      code: method.code,
      name: method.name,
      kind: method.kind,
      stageCounts: { NEW: 0, PRINTED: 0, PACKED: 0, SENT: 0, PICKED_UP: 0 },
      packages: 0,
      gifts: 0,
      groupingSavings: 0,
    });
  }
  for (const group of stageGroups) {
    const summary = summaries.get(group.fulfillmentMethodId);
    if (!summary) continue;
    summary.stageCounts[group.stage] = group._count._all;
    summary.packages += group._count._all;
  }
  for (const group of lineGroups) {
    const summary = summaries.get(group.fulfillmentMethodId);
    if (!summary) continue;
    summary.gifts = group._count._all;
  }
  for (const summary of summaries.values()) {
    summary.groupingSavings = Math.max(0, summary.gifts - summary.packages);
  }
  // Only channels with actual packages (or active methods) are worth a row.
  return [...summaries.values()].filter((summary) => summary.packages > 0 || summary.gifts > 0);
}
