import type { PackageStage, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

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
    order: { seasonId },
    items: { some: {} },
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
        fulfillmentMethod: { select: { id: true, code: true, label: true } },
        order: { select: { id: true, orderNumber: true, draftRef: true } },
        items: {
          select: {
            id: true,
            quantity: true,
            orderLine: {
              select: {
                id: true,
                product: { select: { name: true } },
                addOns: { select: { id: true } },
              },
            },
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
  stageCounts: Record<PackageStage, number>;
  packages: number;
  gifts: number;
  groupingSavings: number;
};

export async function channelSummaries(seasonId: string): Promise<ChannelSummary[]> {
  const [methods, stageGroups, itemGroups] = await Promise.all([
    db.fulfillmentMethod.findMany({ orderBy: { sortOrder: "asc" } }),
    db.package.groupBy({
      by: ["fulfillmentMethodId", "stage"],
      where: { order: { seasonId }, items: { some: {} } },
      _count: { _all: true },
    }),
    db.packageItem.groupBy({
      by: ["packageId"],
      where: { package: { order: { seasonId }, items: { some: {} } } },
      _count: { _all: true },
    }),
  ]);

  // Sum gift lines per method via packages in season.
  const packages = await db.package.findMany({
    where: { order: { seasonId }, items: { some: {} } },
    select: {
      id: true,
      fulfillmentMethodId: true,
      _count: { select: { items: true } },
    },
  });
  const giftsByMethod = new Map<string, number>();
  for (const pkg of packages) {
    giftsByMethod.set(
      pkg.fulfillmentMethodId,
      (giftsByMethod.get(pkg.fulfillmentMethodId) ?? 0) + pkg._count.items,
    );
  }
  void itemGroups;

  const summaries = new Map<string, ChannelSummary>();
  for (const method of methods) {
    summaries.set(method.id, {
      methodId: method.id,
      code: method.code,
      name: method.label,
      stageCounts: { NEW: 0, PRINTED: 0, PACKED: 0, SENT: 0, PICKED_UP: 0 },
      packages: 0,
      gifts: giftsByMethod.get(method.id) ?? 0,
      groupingSavings: 0,
    });
  }
  for (const group of stageGroups) {
    const summary = summaries.get(group.fulfillmentMethodId);
    if (!summary) continue;
    summary.stageCounts[group.stage] = group._count._all;
    summary.packages += group._count._all;
  }
  for (const summary of summaries.values()) {
    summary.groupingSavings = Math.max(0, summary.gifts - summary.packages);
  }
  return [...summaries.values()].filter((summary) => summary.packages > 0 || summary.gifts > 0);
}
