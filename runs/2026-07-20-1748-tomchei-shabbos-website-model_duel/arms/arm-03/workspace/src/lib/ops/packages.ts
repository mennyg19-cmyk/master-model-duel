import { randomBytes } from "node:crypto";
import {
  AuditAction,
  PackageStage,
  type Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";
import { err, maskError, ok, type Result } from "@/lib/result";
import {
  assertMethodTerminal,
  assertPackageTransition,
  canTransitionPackage,
} from "@/lib/orders/package-stages";
import { buildGroupingKey } from "@/lib/orders/grouping";

type Tx = Prisma.TransactionClient;

const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;
const TERMINAL: PackageStage[] = [PackageStage.SENT, PackageStage.PICKED_UP];

export type PackageListFilters = {
  seasonId: string;
  q?: string;
  stage?: PackageStage;
  fulfillmentMethodCode?: string;
  orderId?: string;
  page?: number;
  pageSize?: number;
};

function clampPageSize(raw?: number): number {
  if (!raw || raw < 1) return DEFAULT_PAGE;
  return Math.min(MAX_PAGE, Math.floor(raw));
}

function baseKey(groupingKey: string): string {
  return groupingKey.split("#")[0] ?? groupingKey;
}

function suffixedKey(groupingKey: string, tag: string): string {
  return `${baseKey(groupingKey)}#${tag}-${randomBytes(4).toString("hex")}`;
}

function packageMatchKey(pkg: {
  recipientName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  greeting: string;
  fulfillmentMethod: { code: string };
}): string {
  return buildGroupingKey({
    recipientName: pkg.recipientName,
    addressLine1: pkg.addressLine1,
    addressLine2: pkg.addressLine2,
    city: pkg.city,
    state: pkg.state,
    postalCode: pkg.postalCode,
    country: pkg.country,
    fulfillmentMethodCode: pkg.fulfillmentMethod.code,
    greeting: pkg.greeting,
  });
}

const packageInclude = {
  fulfillmentMethod: { select: { id: true, code: true, label: true } },
  order: {
    select: {
      id: true,
      orderNumber: true,
      draftRef: true,
      status: true,
      seasonId: true,
      customer: { select: { id: true, displayName: true } },
    },
  },
  items: {
    include: {
      orderLine: {
        select: {
          id: true,
          quantity: true,
          product: { select: { name: true, sku: true } },
        },
      },
    },
  },
  audits: { orderBy: { createdAt: "desc" as const }, take: 8 },
} satisfies Prisma.PackageInclude;

export async function listPackages(filters: PackageListFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = clampPageSize(filters.pageSize);
  const where: Prisma.PackageWhereInput = {
    order: { seasonId: filters.seasonId },
  };

  if (filters.stage) where.stage = filters.stage;
  if (filters.orderId) where.orderId = filters.orderId;
  if (filters.fulfillmentMethodCode) {
    where.fulfillmentMethod = { code: filters.fulfillmentMethodCode };
  }

  const q = filters.q?.trim();
  if (q) {
    const asNumber = Number.parseInt(q, 10);
    where.OR = [
      { recipientName: { contains: q, mode: "insensitive" } },
      { postalCode: { contains: q, mode: "insensitive" } },
      { id: { equals: q } },
      { orderId: { equals: q } },
      ...(Number.isFinite(asNumber)
        ? [{ order: { seasonId: filters.seasonId, orderNumber: asNumber } }]
        : []),
      {
        order: {
          seasonId: filters.seasonId,
          draftRef: { contains: q, mode: "insensitive" },
        },
      },
    ];
  }

  const [total, packages] = await Promise.all([
    db.package.count({ where }),
    db.package.findMany({
      where,
      include: packageInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    packages,
  };
}

export async function getPackageDetail(seasonId: string, packageId: string) {
  return db.package.findFirst({
    where: { id: packageId, order: { seasonId } },
    include: packageInclude,
  });
}

/** Production + savings-style summaries by fulfillment channel (season-scoped). */
export async function fulfillmentChannelDashboard(seasonId: string) {
  const rows = await db.package.groupBy({
    by: ["fulfillmentMethodId", "stage"],
    where: { order: { seasonId } },
    _count: { _all: true },
  });

  const methods = await db.fulfillmentMethod.findMany({
    orderBy: { code: "asc" },
  });
  const methodById = new Map(methods.map((m) => [m.id, m]));

  type Channel = {
    methodId: string;
    code: string;
    name: string;
    total: number;
    byStage: Record<string, number>;
  };

  const channels = new Map<string, Channel>();
  for (const method of methods) {
    channels.set(method.id, {
      methodId: method.id,
      code: method.code,
      name: method.label,
      total: 0,
      byStage: {
        NEW: 0,
        PRINTED: 0,
        PACKED: 0,
        SENT: 0,
        PICKED_UP: 0,
      },
    });
  }

  for (const row of rows) {
    const channel = channels.get(row.fulfillmentMethodId);
    if (!channel) {
      const method = methodById.get(row.fulfillmentMethodId);
      if (!method) continue;
      channels.set(row.fulfillmentMethodId, {
        methodId: method.id,
        code: method.code,
        name: method.label,
        total: row._count._all,
        byStage: {
          NEW: 0,
          PRINTED: 0,
          PACKED: 0,
          SENT: 0,
          PICKED_UP: 0,
          [row.stage]: row._count._all,
        },
      });
      continue;
    }
    channel.total += row._count._all;
    channel.byStage[row.stage] = (channel.byStage[row.stage] ?? 0) + row._count._all;
  }

  const list = [...channels.values()];
  const openPackages = list.reduce(
    (sum, c) => sum + c.byStage.NEW + c.byStage.PRINTED + c.byStage.PACKED,
    0,
  );
  const shippedOrPicked = list.reduce(
    (sum, c) => sum + c.byStage.SENT + c.byStage.PICKED_UP,
    0,
  );

  return {
    channels: list,
    production: {
      openPackages,
      shippedOrPicked,
      totalPackages: openPackages + shippedOrPicked,
    },
    savings: {
      printedAwaitingShip: list.reduce((sum, c) => sum + c.byStage.PRINTED + c.byStage.PACKED, 0),
      note: "Margin engine ships in P8; this is queue depth only.",
    },
  };
}

async function lockPackage(tx: Tx, packageId: string, seasonId: string) {
  const scoped = await tx.package.findFirst({
    where: { id: packageId, order: { seasonId } },
    select: { id: true },
  });
  if (!scoped) throw new Error(`Package ${packageId} not found`);
  await tx.$queryRaw`SELECT id FROM "Package" WHERE id = ${packageId} FOR UPDATE`;
  return tx.package.findUniqueOrThrow({
    where: { id: packageId },
    include: { items: true, fulfillmentMethod: true },
  });
}

/**
 * Move selected line items into a new sibling package (same address/method).
 * Split-off keeps the source stage; greeting stays clean (suffix on groupingKey only).
 */
export async function splitPackage(input: {
  seasonId: string;
  packageId: string;
  itemIds: string[];
  actorId?: string | null;
  expectedVersion?: number;
}): Promise<Result<{ sourceId: string; newPackageId: string }>> {
  try {
    const outcome = await db.$transaction(async (tx) => {
      const source = await lockPackage(tx, input.packageId, input.seasonId);
      if (TERMINAL.includes(source.stage)) {
        throw new Error(`Cannot split package in stage ${source.stage}`);
      }
      const version = input.expectedVersion ?? source.version;
      if (source.version !== version) {
        throw new Error(`Package version conflict: expected ${version}, got ${source.version}`);
      }

      const moveIds = new Set(input.itemIds);
      const moving = source.items.filter((row) => moveIds.has(row.id));
      const remaining = source.items.filter((row) => !moveIds.has(row.id));
      if (moving.length === 0) throw new Error("No matching items to split");
      if (remaining.length === 0) {
        throw new Error("Split must leave at least one item on the source package");
      }

      const created = await tx.package.create({
        data: {
          orderId: source.orderId,
          groupingKey: suffixedKey(source.groupingKey, "split"),
          recipientName: source.recipientName,
          addressLine1: source.addressLine1,
          addressLine2: source.addressLine2,
          city: source.city,
          state: source.state,
          postalCode: source.postalCode,
          country: source.country,
          savedAddressId: source.savedAddressId,
          fulfillmentMethodId: source.fulfillmentMethodId,
          greeting: source.greeting,
          stage: source.stage,
          items: {
            create: moving.map((row) => ({
              orderLineId: row.orderLineId,
              quantity: row.quantity,
            })),
          },
          audits: {
            create: {
              actorId: input.actorId ?? null,
              fromStage: null,
              toStage: source.stage,
              note: `Split from package ${source.id}`,
            },
          },
        },
      });

      await tx.packageItem.deleteMany({
        where: { id: { in: moving.map((row) => row.id) } },
      });

      await tx.package.update({
        where: { id: source.id, version },
        data: { version: { increment: 1 } },
      });

      await tx.packageAuditLog.create({
        data: {
          packageId: source.id,
          actorId: input.actorId ?? null,
          fromStage: source.stage,
          toStage: source.stage,
          note: `Split ${moving.length} item(s) -> ${created.id}`,
        },
      });

      await tx.auditLog.create({
        data: {
          action: AuditAction.PACKAGE_SPLIT,
          actorId: input.actorId ?? null,
          meta: {
            orderId: source.orderId,
            sourcePackageId: source.id,
            newPackageId: created.id,
            movedItemIds: moving.map((row) => row.id),
          },
        },
      });

      return { sourceId: source.id, newPackageId: created.id };
    });
    return ok(outcome);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err(maskError(error), `Could not split package: ${detail}`);
  }
}

/**
 * Merge sibling packages with matching grouping keys into the target (first id).
 * Donor packages are emptied + retained (audit trail preserved — no cascade delete).
 */
export async function regroupPackages(input: {
  seasonId: string;
  packageIds: string[];
  actorId?: string | null;
}): Promise<Result<{ targetId: string; mergedIds: string[] }>> {
  try {
    if (input.packageIds.length < 2) {
      throw new Error("Regroup requires at least two packages");
    }
    const outcome = await db.$transaction(async (tx) => {
      const pkgs = [];
      for (const id of input.packageIds) {
        pkgs.push(await lockPackage(tx, id, input.seasonId));
      }
      const orderId = pkgs[0]!.orderId;
      if (pkgs.some((p) => p.orderId !== orderId)) {
        throw new Error("Regroup only allowed within a single order");
      }
      if (pkgs.some((p) => TERMINAL.includes(p.stage))) {
        throw new Error("Cannot regroup shipped or picked-up packages");
      }

      const keys = new Set(pkgs.map((p) => packageMatchKey(p)));
      if (keys.size > 1) {
        throw new Error(
          "Packages can only regroup when recipient, address, method, and greeting all match",
        );
      }

      const target = pkgs[0]!;
      const donors = pkgs.slice(1);
      const mergedIds: string[] = [];

      for (const donor of donors) {
        for (const row of donor.items) {
          const existing = await tx.packageItem.findUnique({
            where: {
              packageId_orderLineId: {
                packageId: target.id,
                orderLineId: row.orderLineId,
              },
            },
          });
          if (existing) {
            await tx.packageItem.update({
              where: { id: existing.id },
              data: { quantity: existing.quantity + row.quantity },
            });
            await tx.packageItem.delete({ where: { id: row.id } });
          } else {
            await tx.packageItem.update({
              where: { id: row.id },
              data: { packageId: target.id },
            });
          }
        }
        await tx.package.update({
          where: { id: donor.id },
          data: { groupingKey: suffixedKey(donor.groupingKey, "regrouped") },
        });
        await tx.packageAuditLog.create({
          data: {
            packageId: donor.id,
            actorId: input.actorId ?? null,
            fromStage: donor.stage,
            toStage: donor.stage,
            note: `Regrouped into ${target.id}`,
          },
        });
        mergedIds.push(donor.id);
      }

      await tx.package.update({
        where: { id: target.id },
        data: { version: { increment: 1 } },
      });

      await tx.packageAuditLog.create({
        data: {
          packageId: target.id,
          actorId: input.actorId ?? null,
          fromStage: target.stage,
          toStage: target.stage,
          note: `Absorbed packages ${mergedIds.join(", ")}`,
        },
      });

      await tx.auditLog.create({
        data: {
          action: AuditAction.PACKAGE_REGROUPED,
          actorId: input.actorId ?? null,
          meta: {
            orderId,
            targetPackageId: target.id,
            mergedPackageIds: mergedIds,
          },
        },
      });

      return { targetId: target.id, mergedIds };
    });
    return ok(outcome);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err(maskError(error), `Could not regroup packages: ${detail}`);
  }
}

export async function bulkAdvancePackageStage(input: {
  seasonId: string;
  items: Array<{ packageId: string; expectedVersion?: number }>;
  toStage: PackageStage;
  actorId?: string | null;
}): Promise<
  Result<{
    updated: string[];
    skipped: Array<{ packageId: string; reason: string }>;
  }>
> {
  try {
    const updated: string[] = [];
    const skipped: Array<{ packageId: string; reason: string }> = [];

    for (const entry of input.items) {
      const pkg = await db.package.findFirst({
        where: { id: entry.packageId, order: { seasonId: input.seasonId } },
        include: { fulfillmentMethod: { select: { code: true } } },
      });
      if (!pkg) {
        skipped.push({ packageId: entry.packageId, reason: "not found" });
        continue;
      }
      if (!canTransitionPackage(pkg.stage, input.toStage)) {
        skipped.push({
          packageId: entry.packageId,
          reason: `illegal ${pkg.stage} -> ${input.toStage}`,
        });
        continue;
      }
      try {
        assertPackageTransition(pkg.stage, input.toStage);
        assertMethodTerminal(pkg.fulfillmentMethod.code, input.toStage);
        const version = entry.expectedVersion ?? pkg.version;
        await db.$transaction(async (tx) => {
          const locked = await lockPackage(tx, entry.packageId, input.seasonId);
          assertPackageTransition(locked.stage, input.toStage);
          assertMethodTerminal(locked.fulfillmentMethod.code, input.toStage);
          if (locked.version !== version) {
            throw new Error(`version conflict ${locked.version}≠${version}`);
          }
          const next = await tx.package.update({
            where: { id: locked.id, version },
            data: { stage: input.toStage, version: { increment: 1 } },
          });
          await tx.packageAuditLog.create({
            data: {
              packageId: locked.id,
              actorId: input.actorId ?? null,
              fromStage: locked.stage,
              toStage: input.toStage,
            },
          });
          await tx.auditLog.create({
            data: {
              action: AuditAction.PACKAGE_STAGE_CHANGED,
              actorId: input.actorId ?? null,
              meta: {
                packageId: locked.id,
                orderId: locked.orderId,
                from: locked.stage,
                to: input.toStage,
                versionBefore: locked.version,
                versionAfter: next.version,
                bulk: true,
              },
            },
          });
        });
        updated.push(entry.packageId);
      } catch (error) {
        skipped.push({
          packageId: entry.packageId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return ok({ updated, skipped });
  } catch (error) {
    return err(maskError(error), "Could not bulk-update package stages.");
  }
}
