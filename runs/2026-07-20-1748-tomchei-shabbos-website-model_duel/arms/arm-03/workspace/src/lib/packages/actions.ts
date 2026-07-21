/**
 * @deprecated Dead parallel engine. Live path is `@/lib/ops/packages`.
 * Kept only so historical imports compile; do not wire new routes here.
 */
import { randomBytes } from "node:crypto";
import {
  AuditAction,
  PackageStage,
  type Package,
  type Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";
import { assertPackageTransition } from "@/lib/orders/package-stages";
import { buildGroupingKey } from "@/lib/orders/grouping";

export class ActionError extends Error {
  constructor(
    message: string,
    readonly status: number = 409,
  ) {
    super(message);
  }
}

const TERMINAL: PackageStage[] = [PackageStage.SENT, PackageStage.PICKED_UP];

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

export type SplitPart = { itemId: string; quantity: number };

/**
 * Split quantities into a new package with the same recipient/address/method/greeting.
 * Whole PackageItem rows move; partial quantities split the OrderLine.
 */
export async function splitPackage(
  seasonId: string,
  packageId: string,
  parts: SplitPart[],
  actorId?: string | null,
) {
  if (parts.length === 0) throw new ActionError("Pick at least one item to split out", 400);
  const byItem = new Map(parts.map((part) => [part.itemId, part.quantity]));
  if (byItem.size !== parts.length) throw new ActionError("Each item may appear once in a split", 400);

  return db.$transaction(async (tx) => {
    const source = await tx.package.findFirst({
      where: { id: packageId, order: { seasonId } },
      include: {
        items: {
          include: {
            orderLine: { include: { addOns: true, productOption: true } },
          },
        },
      },
    });
    if (!source) throw new ActionError("Package not found", 404);
    if (TERMINAL.includes(source.stage)) {
      throw new ActionError(
        `A ${source.stage.toLowerCase().replace("_", " ")} package cannot be split`,
      );
    }

    let movedUnits = 0;
    const totalUnits = source.items.reduce((sum, item) => sum + item.quantity, 0);
    const moves: {
      item: (typeof source.items)[number];
      quantity: number;
    }[] = [];

    for (const [itemId, quantity] of byItem) {
      const item = source.items.find((candidate) => candidate.id === itemId);
      if (!item) throw new ActionError("A selected item no longer belongs to this package", 409);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > item.quantity) {
        throw new ActionError(
          `Quantity must be between 1 and ${item.quantity}`,
          400,
        );
      }
      moves.push({ item, quantity });
      movedUnits += quantity;
    }
    if (movedUnits >= totalUnits) {
      throw new ActionError(
        "Leave at least one item in the original package — a split makes two boxes",
        400,
      );
    }

    const target = await tx.package.create({
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
        version: source.version,
      },
    });

    for (const { item, quantity } of moves) {
      const line = item.orderLine;
      if (quantity === item.quantity) {
        await tx.packageItem.update({
          where: { id: item.id },
          data: { packageId: target.id },
        });
        continue;
      }
      if (line.addOns.length > 0) {
        throw new ActionError(
          "Items with add-ons move whole — split the full quantity instead",
          400,
        );
      }
      await tx.packageItem.update({
        where: { id: item.id },
        data: { quantity: item.quantity - quantity },
      });
      await tx.orderLine.update({
        where: { id: line.id },
        data: { quantity: line.quantity - quantity },
      });
      const newLine = await tx.orderLine.create({
        data: {
          orderId: line.orderId,
          productId: line.productId,
          productOptionId: line.productOptionId,
          quantity,
          unitPriceCents: line.unitPriceCents,
          optionAdjustCents: line.optionAdjustCents,
          recipientName: line.recipientName,
          addressLine1: line.addressLine1,
          addressLine2: line.addressLine2,
          city: line.city,
          state: line.state,
          postalCode: line.postalCode,
          country: line.country,
          savedAddressId: line.savedAddressId,
          fulfillmentMethodId: line.fulfillmentMethodId,
          greeting: line.greeting,
          groupingKey: line.groupingKey,
        },
      });
      await tx.packageItem.create({
        data: { packageId: target.id, orderLineId: newLine.id, quantity },
      });
    }

    const note = `split → ${target.id} (${movedUnits} units)`;
    await tx.packageAuditLog.create({
      data: {
        packageId: source.id,
        actorId: actorId ?? null,
        fromStage: source.stage,
        toStage: source.stage,
        note,
      },
    });
    await tx.packageAuditLog.create({
      data: {
        packageId: target.id,
        actorId: actorId ?? null,
        fromStage: null,
        toStage: source.stage,
        note: `split from ${source.id}`,
      },
    });
    await tx.auditLog.create({
      data: {
        action: AuditAction.PACKAGE_SPLIT,
        actorId: actorId ?? null,
        meta: { sourceId: source.id, targetId: target.id, movedUnits },
      },
    });
    return { sourceId: source.id, targetId: target.id };
  });
}

/** Merge matching NEW packages into the oldest; emptied sources keep audit rows. */
export async function regroupPackages(
  seasonId: string,
  packageIds: string[],
  actorId?: string | null,
) {
  const ids = [...new Set(packageIds)];
  if (ids.length < 2) throw new ActionError("Pick at least two packages to regroup", 400);

  return db.$transaction(async (tx) => {
    const packages = await tx.package.findMany({
      where: { id: { in: ids }, order: { seasonId } },
      include: {
        items: { select: { id: true } },
        fulfillmentMethod: { select: { code: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    if (packages.length !== ids.length) {
      throw new ActionError("A selected package no longer exists in this season", 409);
    }
    if (packages.some((entry) => entry.stage !== PackageStage.NEW)) {
      throw new ActionError("Only packages still at New can be regrouped");
    }
    if (packages.some((entry) => entry.items.length === 0)) {
      throw new ActionError("An empty package cannot be regrouped");
    }
    const keys = new Set(packages.map((entry) => packageMatchKey(entry)));
    if (keys.size > 1) {
      throw new ActionError(
        "Packages can only regroup when recipient, address, method, and greeting all match",
        400,
      );
    }

    const [target, ...sources] = packages;
    if (!target) throw new ActionError("Pick at least two packages to regroup", 400);

    for (const sourcePackage of sources) {
      await tx.packageItem.updateMany({
        where: { packageId: sourcePackage.id },
        data: { packageId: target.id },
      });
      await tx.package.update({
        where: { id: sourcePackage.id },
        data: { groupingKey: suffixedKey(sourcePackage.groupingKey, "regrouped") },
      });
      await tx.packageAuditLog.create({
        data: {
          packageId: sourcePackage.id,
          actorId: actorId ?? null,
          fromStage: PackageStage.NEW,
          toStage: PackageStage.NEW,
          note: `regrouped into ${target.id}`,
        },
      });
    }
    await tx.packageAuditLog.create({
      data: {
        packageId: target.id,
        actorId: actorId ?? null,
        fromStage: PackageStage.NEW,
        toStage: PackageStage.NEW,
        note: `regrouped from ${sources.map((s) => s.id).join(",")}`,
      },
    });
    await tx.auditLog.create({
      data: {
        action: AuditAction.PACKAGE_REGROUPED,
        actorId: actorId ?? null,
        meta: {
          targetId: target.id,
          mergedIds: sources.map((entry) => entry.id),
        },
      },
    });
    return { targetId: target.id, mergedIds: sources.map((entry) => entry.id) };
  });
}

export async function advancePackageStage(
  seasonId: string,
  packageId: string,
  to: PackageStage,
  version: number,
  actorId?: string | null,
  outerTx?: Prisma.TransactionClient,
): Promise<{ package: Package; from: PackageStage; to: PackageStage }> {
  const run = async (tx: Prisma.TransactionClient) => {
    const current = await tx.package.findFirst({
      where: { id: packageId, order: { seasonId } },
    });
    if (!current) throw new ActionError("Package not found", 404);
    try {
      assertPackageTransition(current.stage, to);
    } catch (error) {
      throw new ActionError(error instanceof Error ? error.message : "Illegal transition", 409);
    }

    const updated = await tx.package.updateMany({
      where: { id: packageId, version },
      data: { stage: to, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new ActionError(
        "Someone else just updated this package — refresh to see its current stage",
      );
    }
    const pkg = await tx.package.findUniqueOrThrow({ where: { id: packageId } });
    await tx.packageAuditLog.create({
      data: {
        packageId,
        actorId: actorId ?? null,
        fromStage: current.stage,
        toStage: to,
      },
    });
    await tx.auditLog.create({
      data: {
        action: AuditAction.PACKAGE_STAGE_CHANGED,
        actorId: actorId ?? null,
        meta: { packageId, from: current.stage, to },
      },
    });
    return { package: pkg, from: current.stage, to };
  };
  return outerTx ? run(outerTx) : db.$transaction(run);
}

export function terminalStageForMethodCode(code: string): PackageStage {
  return code === "PICKUP" ? PackageStage.PICKED_UP : PackageStage.SENT;
}
