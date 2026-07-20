import { randomUUID } from "node:crypto";
import {
  PackageStage,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { groupLinesIntoPackages } from "@/domain/package-grouping";
import { advancePackageStage } from "@/domain/package-stage";

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

export async function materializeOrderPackages(
  prisma: DatabaseClient,
  orderId: string,
) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      packages: { select: { id: true } },
      lines: {
        include: {
          recipientAddress: true,
          fulfillmentMethod: true,
        },
      },
    },
  });
  if (order.status !== "FINALIZED" || order.packages.length > 0) {
    return 0;
  }
  if (
    order.lines.some(
      (line) =>
        !line.recipientAddress ||
        !line.fulfillmentMethod ||
        !line.recipientNameSnapshot,
    )
  ) {
    throw new Error(
      "Finalized orders need recipient, address, and fulfillment snapshots before package materialization.",
    );
  }

  const linesById = new Map(order.lines.map((line) => [line.id, line]));
  const groups = groupLinesIntoPackages(
    order.lines.map((line) => ({
      lineId: line.id,
      quantity: line.quantity,
      recipientName: line.recipientNameSnapshot!,
      addressKey: line.recipientAddress!.normalizedKey,
      fulfillmentMethodCode: line.fulfillmentMethod!.code,
      greeting: line.greetingSnapshot,
    })),
  );

  for (const group of groups) {
    const firstLine = linesById.get(group.lines[0]!.lineId)!;
    const address = firstLine.recipientAddress!;
    const createdPackage = await prisma.package.create({
      data: {
        orderId,
        recipientAddressId: address.id,
        fulfillmentMethodId: firstLine.fulfillmentMethodId!,
        recipientName: firstLine.recipientNameSnapshot!,
        addressSnapshot: {
          line1: address.line1,
          line2: address.line2,
          city: address.city,
          region: address.region,
          postalCode: address.postalCode,
          countryCode: address.countryCode,
        },
        greetingSnapshot: firstLine.greetingSnapshot,
        groupingKey: group.groupingKey,
        lines: {
          create: group.lines.map((line) => ({
            orderLineId: line.lineId,
            quantity: line.quantity,
          })),
        },
      },
    });
    await prisma.packageAudit.create({
      data: {
        packageId: createdPackage.id,
        action: "package.materialized",
        metadata: { orderId, groupingKey: group.groupingKey },
      },
    });
  }
  return groups.length;
}

export async function materializeMissingFinalizedOrders(prisma: PrismaClient) {
  const orders = await prisma.order.findMany({
    where: { status: "FINALIZED", packages: { none: {} } },
    orderBy: { finalizedAt: "asc" },
    take: 200,
    select: { id: true },
  });
  let packageCount = 0;
  const skipped: { orderId: string; reason: string }[] = [];
  for (const order of orders) {
    try {
      packageCount += await prisma.$transaction((transaction) =>
        materializeOrderPackages(transaction, order.id),
      );
    } catch (error) {
      skipped.push({
        orderId: order.id,
        reason:
          error instanceof Error
            ? error.message
            : "Package materialization failed.",
      });
    }
  }
  return { orderCount: orders.length - skipped.length, packageCount, skipped };
}

export async function splitPackage(
  prisma: PrismaClient,
  input: {
    packageId: string;
    packageLineId: string;
    quantity: number;
    actorStaffId: string;
  },
) {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new Error("Split quantity must be a positive whole number.");
  }
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id" FROM "Package" WHERE "id" = ${input.packageId} FOR UPDATE
    `;
    const source = await transaction.package.findUniqueOrThrow({
      where: { id: input.packageId },
      include: { lines: true },
    });
    if (!source.isActive || ["SENT", "PICKED_UP"].includes(source.stage)) {
      throw new Error("Only active, unfulfilled packages can be split.");
    }
    const packageLine = source.lines.find((line) => line.id === input.packageLineId);
    if (!packageLine || input.quantity > packageLine.quantity) {
      throw new Error("Split quantity exceeds the selected package line.");
    }
    if (source.lines.length === 1 && input.quantity === packageLine.quantity) {
      throw new Error("A split must leave at least one item in the original package.");
    }

    const createdPackage = await transaction.package.create({
      data: {
        orderId: source.orderId,
        recipientAddressId: source.recipientAddressId,
        fulfillmentMethodId: source.fulfillmentMethodId,
        recipientName: source.recipientName,
        addressSnapshot: source.addressSnapshot ?? Prisma.JsonNull,
        greetingSnapshot: source.greetingSnapshot,
        groupingKey: `${source.groupingKey}:split:${randomUUID()}`,
        lines: {
          create: {
            orderLineId: packageLine.orderLineId,
            quantity: input.quantity,
          },
        },
      },
    });
    if (input.quantity === packageLine.quantity) {
      await transaction.packageLine.delete({ where: { id: packageLine.id } });
    } else {
      await transaction.packageLine.update({
        where: { id: packageLine.id },
        data: { quantity: { decrement: input.quantity } },
      });
    }
    await transaction.package.update({
      where: { id: source.id },
      data: { version: { increment: 1 } },
    });
    await transaction.packageAudit.createMany({
      data: [
        {
          packageId: source.id,
          actorStaffId: input.actorStaffId,
          action: "package.split.source",
          metadata: {
            createdPackageId: createdPackage.id,
            orderLineId: packageLine.orderLineId,
            quantity: input.quantity,
          },
        },
        {
          packageId: createdPackage.id,
          actorStaffId: input.actorStaffId,
          action: "package.split.created",
          metadata: {
            sourcePackageId: source.id,
            orderLineId: packageLine.orderLineId,
            quantity: input.quantity,
          },
        },
      ],
    });
    return createdPackage;
  });
}

export async function regroupPackages(
  prisma: PrismaClient,
  sourcePackageId: string,
  targetPackageId: string,
  actorStaffId: string,
) {
  if (sourcePackageId === targetPackageId) {
    throw new Error("Choose two different packages to regroup.");
  }
  return prisma.$transaction(async (transaction) => {
    for (const packageId of [sourcePackageId, targetPackageId].sort()) {
      await transaction.$queryRaw`
        SELECT "id" FROM "Package" WHERE "id" = ${packageId} FOR UPDATE
      `;
    }
    const packages = await transaction.package.findMany({
      where: { id: { in: [sourcePackageId, targetPackageId] } },
      include: { lines: true },
      orderBy: { id: "asc" },
    });
    const source = packages.find((entry) => entry.id === sourcePackageId);
    const target = packages.find((entry) => entry.id === targetPackageId);
    if (!source || !target || source.orderId !== target.orderId) {
      throw new Error("Regrouping requires two packages from the same order.");
    }
    if (
      !source.isActive ||
      !target.isActive ||
      [source.stage, target.stage].some(
        (stage) =>
          stage === PackageStage.SENT || stage === PackageStage.PICKED_UP,
      )
    ) {
      throw new Error("Only active, unfulfilled packages can be regrouped.");
    }
    for (const sourceLine of source.lines) {
      const targetLine = target.lines.find(
        (line) => line.orderLineId === sourceLine.orderLineId,
      );
      if (targetLine) {
        await transaction.packageLine.update({
          where: { id: targetLine.id },
          data: { quantity: { increment: sourceLine.quantity } },
        });
        await transaction.packageLine.delete({ where: { id: sourceLine.id } });
      } else {
        await transaction.packageLine.update({
          where: { id: sourceLine.id },
          data: { packageId: target.id },
        });
      }
    }
    await transaction.package.update({
      where: { id: source.id },
      data: { isActive: false, version: { increment: 1 } },
    });
    await transaction.package.update({
      where: { id: target.id },
      data: { version: { increment: 1 } },
    });
    await transaction.packageAudit.createMany({
      data: [
        {
          packageId: source.id,
          actorStaffId,
          action: "package.regrouped.source",
          metadata: { targetPackageId: target.id },
        },
        {
          packageId: target.id,
          actorStaffId,
          action: "package.regrouped.target",
          metadata: { sourcePackageId: source.id },
        },
      ],
    });
    return target;
  });
}

export async function bulkAdvancePackageStage(
  prisma: PrismaClient,
  actorStaffId: string,
  requests: { packageId: string; version: number; stage: PackageStage }[],
) {
  const applied: string[] = [];
  const conflicts: { packageId: string; reason: string }[] = [];
  for (const request of requests.slice(0, 100)) {
    try {
      await advancePackageStage(
        prisma,
        request.packageId,
        request.version,
        request.stage,
        actorStaffId,
      );
      applied.push(request.packageId);
    } catch (error) {
      conflicts.push({
        packageId: request.packageId,
        reason: error instanceof Error ? error.message : "Package status failed.",
      });
    }
  }
  return { applied, conflicts };
}
