import { randomBytes } from "node:crypto";
import type { PackageStage, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { packageGroupingKey } from "@/lib/domain/grouping";
import { canAdvancePackage } from "@/lib/domain/package-stage";

// Staff package operations (UR-001, G-003, G-004): split, regroup, and stage
// advance. Every mutation writes PackageAudit inside its own transaction.
// Thrown ActionError messages are safe to show staff verbatim.

export class ActionError extends Error {
  constructor(message: string, readonly status: number = 409) {
    super(message);
  }
}

const TERMINAL_STAGES: PackageStage[] = ["SENT", "PICKED_UP"];

// Staff-made packages get a suffixed grouping key so (a) the NEW-stage partial
// unique index on (seasonId, groupingKey) holds and (b) a later finalize never
// merges new lines into a package staff deliberately carved out.
function baseKey(groupingKey: string): string {
  return groupingKey.split("#")[0];
}

function suffixedKey(groupingKey: string, tag: string): string {
  return `${baseKey(groupingKey)}#${tag}-${randomBytes(4).toString("hex")}`;
}

export type SplitPart = { lineId: string; quantity: number };

/**
 * Move the chosen line quantities into a brand-new package with the same
 * recipient/address/method/greeting. Whole-line moves re-point the line;
 * partial quantities split the line row (unit price snapshot preserved, option
 * rows cloned). Lines with add-ons only move whole — add-on units per line
 * cannot be divided meaningfully.
 */
export async function splitPackage(packageId: string, parts: SplitPart[], actorStaffId?: string) {
  if (parts.length === 0) throw new ActionError("Pick at least one item to split out", 400);
  const byLine = new Map(parts.map((part) => [part.lineId, part.quantity]));
  if (byLine.size !== parts.length) throw new ActionError("Each line may appear once in a split", 400);

  return db.$transaction(async (tx) => {
    const source = await tx.package.findUnique({
      where: { id: packageId },
      include: { lines: { include: { options: true } } },
    });
    if (!source) throw new ActionError("Package not found", 404);
    if (TERMINAL_STAGES.includes(source.stage)) {
      throw new ActionError(`A ${source.stage.toLowerCase().replace("_", " ")} package cannot be split`);
    }

    let movedUnits = 0;
    const totalUnits = source.lines.reduce((sum, line) => sum + line.quantity, 0);
    const moves: { line: (typeof source.lines)[number]; quantity: number }[] = [];
    for (const [lineId, quantity] of byLine) {
      const line = source.lines.find((candidate) => candidate.id === lineId);
      if (!line) throw new ActionError("A selected item no longer belongs to this package", 409);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > line.quantity) {
        throw new ActionError(`Quantity for ${line.recipientName}'s item must be between 1 and ${line.quantity}`, 400);
      }
      moves.push({ line, quantity });
      movedUnits += quantity;
    }
    if (movedUnits >= totalUnits) {
      throw new ActionError("Leave at least one item in the original package — a split makes two boxes", 400);
    }

    const target = await tx.package.create({
      data: {
        seasonId: source.seasonId,
        groupingKey: suffixedKey(source.groupingKey, "split"),
        recipientName: source.recipientName,
        addressLine1: source.addressLine1,
        addressLine2: source.addressLine2,
        city: source.city,
        state: source.state,
        zip: source.zip,
        fulfillmentMethodId: source.fulfillmentMethodId,
        greeting: source.greeting,
        stage: source.stage,
      },
    });

    for (const { line, quantity } of moves) {
      if (quantity === line.quantity) {
        await tx.orderLine.update({ where: { id: line.id }, data: { packageId: target.id } });
        continue;
      }
      const addOnCount = await tx.orderLineAddOn.count({ where: { orderLineId: line.id } });
      if (addOnCount > 0) {
        throw new ActionError("Items with add-ons move whole — split the full quantity instead", 400);
      }
      await tx.orderLine.update({ where: { id: line.id }, data: { quantity: line.quantity - quantity } });
      await tx.orderLine.create({
        data: {
          orderId: line.orderId,
          productId: line.productId,
          quantity,
          unitPriceCents: line.unitPriceCents,
          recipientName: line.recipientName,
          addressLine1: line.addressLine1,
          addressLine2: line.addressLine2,
          city: line.city,
          state: line.state,
          zip: line.zip,
          fulfillmentMethodId: line.fulfillmentMethodId,
          greeting: line.greeting,
          packageId: target.id,
          options: {
            create: line.options.map((option) => ({
              productOptionId: option.productOptionId,
              priceAdjustmentCents: option.priceAdjustmentCents,
            })),
          },
        },
      });
    }

    const detail = {
      movedUnits,
      parts: moves.map(({ line, quantity }) => ({ lineId: line.id, quantity })),
    };
    await tx.packageAudit.create({
      data: { packageId: source.id, actorStaffId, action: "split_out", detail: { ...detail, toPackageId: target.id } },
    });
    await tx.packageAudit.create({
      data: { packageId: target.id, actorStaffId, action: "split_from", detail: { ...detail, fromPackageId: source.id } },
    });
    return { sourceId: source.id, targetId: target.id };
  });
}

/**
 * Merge packages that carry identical grouping fields back into the oldest one.
 * Sources keep their rows (full audit history retained, G-003) but are emptied
 * and their keys retired so finalize never merges future lines into them; the
 * board hides packages without lines.
 */
export async function regroupPackages(packageIds: string[], actorStaffId?: string) {
  const ids = [...new Set(packageIds)];
  if (ids.length < 2) throw new ActionError("Pick at least two packages to regroup", 400);

  return db.$transaction(async (tx) => {
    const packages = await tx.package.findMany({
      where: { id: { in: ids } },
      include: { lines: { select: { id: true } } },
      orderBy: { createdAt: "asc" },
    });
    if (packages.length !== ids.length) throw new ActionError("A selected package no longer exists", 409);
    if (packages.some((entry) => entry.stage !== "NEW")) {
      throw new ActionError("Only packages still at New can be regrouped");
    }
    if (packages.some((entry) => entry.lines.length === 0)) {
      throw new ActionError("An empty package cannot be regrouped");
    }
    const keys = new Set(packages.map((entry) => packageGroupingKey(entry)));
    if (keys.size > 1) {
      throw new ActionError(
        "Packages can only regroup when recipient, address, method, and greeting all match",
        400
      );
    }

    const [target, ...sources] = packages;
    for (const sourcePackage of sources) {
      await tx.orderLine.updateMany({
        where: { packageId: sourcePackage.id },
        data: { packageId: target.id },
      });
      await tx.package.update({
        where: { id: sourcePackage.id },
        data: { groupingKey: suffixedKey(sourcePackage.groupingKey, "regrouped") },
      });
      await tx.packageAudit.create({
        data: {
          packageId: sourcePackage.id,
          actorStaffId,
          action: "regrouped_into",
          detail: { targetPackageId: target.id, movedLineIds: sourcePackage.lines.map((line) => line.id) },
        },
      });
    }
    await tx.packageAudit.create({
      data: {
        packageId: target.id,
        actorStaffId,
        action: "regrouped_from",
        detail: { sourcePackageIds: sources.map((entry) => entry.id) },
      },
    });
    return { targetId: target.id, mergedIds: sources.map((entry) => entry.id) };
  });
}

/**
 * Version-guarded forward stage move (G-004). The conditional update is the
 * lock: two staff advancing the same package race on version and exactly one
 * wins; the loser gets a 409 with the fresh stage.
 */
export async function advancePackageStage(
  packageId: string,
  to: PackageStage,
  version: number,
  actorStaffId?: string,
  outerTx?: Prisma.TransactionClient
) {
  const run = async (tx: Prisma.TransactionClient) => {
    const current = await tx.package.findUnique({
      where: { id: packageId },
      include: { fulfillmentMethod: { select: { kind: true } } },
    });
    if (!current) throw new ActionError("Package not found", 404);
    const allowed = canAdvancePackage(current.stage, to, current.fulfillmentMethod.kind);
    if (!allowed.ok) throw new ActionError(allowed.reason);

    const updated = await tx.package.updateMany({
      where: { id: packageId, version },
      data: { stage: to, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new ActionError("Someone else just updated this package — refresh to see its current stage");
    }
    await tx.packageAudit.create({
      data: { packageId, actorStaffId, action: "stage_advanced", detail: { from: current.stage, to } },
    });
    return { from: current.stage, to };
  };
  return outerTx ? run(outerTx) : db.$transaction(run);
}
