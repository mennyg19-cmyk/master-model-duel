import { randomUUID } from "node:crypto";
import { PackageStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatEnumLabel, groupPackageCandidates, packageItemCount } from "@/lib/packages";

type Transaction = Prisma.TransactionClient;
type WireLine = { productId: string; productOptionId?: string; quantity: number; recipient: { addressId: string } };
type CheckoutRecipient = { addressId: string; method: string; greeting: string };

const PACKAGE_DASHBOARD_PAGE_SIZE = 100;

const allowedTransitions: Record<PackageStatus, PackageStatus[]> = {
  NEW: ["PRINTED", "PACKED", "SENT", "PICKED_UP"],
  PRINTED: ["PACKED", "SENT", "PICKED_UP"],
  PACKED: ["SENT", "PICKED_UP"],
  SENT: [],
  PICKED_UP: [],
  UNCLAIMED: [],
};

function readCheckout(wireFormat: Prisma.JsonValue) {
  if (!wireFormat || typeof wireFormat !== "object" || Array.isArray(wireFormat)) {
    throw new Error("Finalized order is missing package details.");
  }
  const stored = wireFormat as { lines?: unknown; checkout?: { recipients?: unknown } };
  if (!Array.isArray(stored.lines) || !Array.isArray(stored.checkout?.recipients)) {
    throw new Error("Finalized order is missing recipient fulfillment details.");
  }
  return {
    lines: stored.lines as WireLine[],
    recipients: stored.checkout.recipients as CheckoutRecipient[],
  };
}

function lineKey(line: { productId: string; productOptionId: string | null; quantity: number }) {
  return `${line.productId}:${line.productOptionId ?? ""}:${line.quantity}`;
}

export async function materializeFinalizedOrder(transaction: Transaction, orderId: string, actorId?: string) {
  const existing = await transaction.package.findMany({
    where: { orderId, isActive: true },
    select: { id: true },
  });
  if (existing.length) return existing;

  const order = await transaction.order.findUnique({
    where: { id: orderId },
    include: { lines: { orderBy: { id: "asc" } }, customer: { include: { addresses: true } } },
  });
  if (!order || order.status !== "FINALIZED") throw new Error("Packages can only be created for a finalized order.");
  const checkout = readCheckout(order.wireFormat);
  const addresses = new Map(order.customer?.addresses.map((address) => [address.id, address]));
  const recipients = new Map(checkout.recipients.map((recipient) => [recipient.addressId, recipient]));
  const lineQueues = new Map<string, typeof order.lines>();
  for (const line of order.lines) {
    const key = lineKey(line);
    lineQueues.set(key, [...(lineQueues.get(key) ?? []), line]);
  }

  const candidates = [];
  for (const wireLine of checkout.lines) {
    const matchingLines = lineQueues.get(lineKey({ ...wireLine, productOptionId: wireLine.productOptionId ?? null }));
    const orderLine = matchingLines?.shift();
    const address = addresses.get(wireLine.recipient.addressId);
    const recipient = recipients.get(wireLine.recipient.addressId);
    if (!orderLine || !address || !recipient) throw new Error("Finalized order has incomplete line or recipient data.");
    const method = await transaction.fulfillmentMethod.upsert({
      where: { code: recipient.method },
      create: { code: recipient.method, name: formatEnumLabel(recipient.method) },
      update: { name: formatEnumLabel(recipient.method) },
    });
    candidates.push({
      orderLine,
      address,
      method,
      greeting: recipient.greeting,
      recipientKey: address.recipientName,
      addressId: address.id,
      fulfillmentMethodId: method.id,
    });
  }

  const packages = [];
  for (const group of groupPackageCandidates(candidates)) {
    const first = group.candidates[0];
    const created = await transaction.package.create({
      data: {
        orderId,
        addressId: first.addressId,
        fulfillmentMethodId: first.fulfillmentMethodId,
        recipientName: first.address.recipientName,
        greeting: first.greeting,
        groupingKey: group.key,
        lines: {
          create: group.candidates.map((candidate) => ({
            orderLineId: candidate.orderLine.id,
            quantity: candidate.orderLine.quantity,
          })),
        },
      },
      select: { id: true },
    });
    packages.push(created);
    await transaction.packageAudit.create({
      data: {
        packageId: created.id,
        actorId,
        action: "package.materialized",
        details: { orderId, orderLineIds: group.candidates.map((candidate) => candidate.orderLine.id) },
      },
    });
  }
  return packages;
}

export function materializeOrderPackages(orderId: string, actorId?: string) {
  return prisma.$transaction((transaction) => materializeFinalizedOrder(transaction, orderId, actorId));
}

export async function packageDashboard(page = 1) {
  const where = { isActive: true };
  const [total, packages, packageSummaries] = await prisma.$transaction([
    prisma.package.count({ where }),
    prisma.package.findMany({
    where: { isActive: true },
    include: {
      order: { select: { id: true, orderNumber: true, draftReference: true } },
      fulfillmentMethod: true,
      lines: true,
      shipmentBoxes: {
        where: { externalLabelId: { not: null }, labelVoidedAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { externalLabelId: true, carrier: true, service: true, labelUrl: true, trackingNumber: true, trackingStatus: true },
      },
    },
    orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PACKAGE_DASHBOARD_PAGE_SIZE,
      take: PACKAGE_DASHBOARD_PAGE_SIZE,
    }),
    prisma.package.findMany({
      where,
      select: { fulfillmentMethod: { select: { code: true } }, lines: { select: { quantity: true } } },
    }),
  ]);
  const channels = new Map<string, { code: string; packageCount: number; productionUnits: number }>();
  for (const packageRecord of packageSummaries) {
    const productionUnits = packageItemCount(packageRecord.lines);
    const channel = channels.get(packageRecord.fulfillmentMethod.code) ?? {
      code: packageRecord.fulfillmentMethod.code,
      packageCount: 0,
      productionUnits: 0,
    };
    channel.packageCount += 1;
    channel.productionUnits += productionUnits;
    channels.set(channel.code, channel);
  }
  const productionUnits = [...channels.values()].reduce((total, channel) => total + channel.productionUnits, 0);
  return {
    packages,
    total,
    page,
    pageSize: PACKAGE_DASHBOARD_PAGE_SIZE,
    channels: [...channels.values()],
    productionUnits,
    consolidatedItems: Math.max(0, productionUnits - packages.length),
  };
}

export async function advancePackageStatus(packageId: string, version: number, status: PackageStatus, actorId: string) {
  const packageRecord = await prisma.package.findFirst({
    where: { id: packageId, order: { status: "FINALIZED" } },
  });
  if (!packageRecord) throw new Error("Package was not found in a finalized order.");
  if (!packageRecord.isActive) throw new Error("This package has been regrouped and cannot be updated.");
  if (!allowedTransitions[packageRecord.status].includes(status)) {
    throw new Error(`Cannot change a ${packageRecord.status.toLowerCase()} package directly to ${status.toLowerCase()}.`);
  }
  await prisma.$transaction(async (transaction) => {
    const updated = await transaction.package.updateMany({
      where: { id: packageId, version, status: packageRecord.status, isActive: true, order: { status: "FINALIZED" } },
      data: { status, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new Error("This package changed before its status could be saved.");
    await transaction.packageAudit.create({
      data: { packageId, actorId, action: "package.status_changed", details: { from: packageRecord.status, to: status } },
    });
  });
}

export async function updatePackageStatuses(packageIds: string[], versions: Record<string, number>, status: PackageStatus, actorId: string) {
  return Promise.all(packageIds.map(async (packageId) => {
    try {
      await advancePackageStatus(packageId, versions[packageId], status, actorId);
      return { packageId, outcome: "updated" };
    } catch (error) {
      return { packageId, outcome: "conflict", reason: error instanceof Error ? error.message : "Package status could not be updated." };
    }
  }));
}

export async function splitPackage(packageId: string, version: number, actorId: string) {
  return prisma.$transaction(async (transaction) => {
    const source = await transaction.package.findFirst({
      where: { id: packageId, version, isActive: true, status: "NEW", order: { status: "FINALIZED" } },
      include: { lines: { orderBy: { quantity: "desc" } } },
    });
    if (!source) throw new Error("Only current new packages from finalized orders can be split.");
    const sourceLine = source.lines[0];
    if (!sourceLine || packageItemCount(source.lines) < 2) {
      throw new Error("A package needs at least two items before it can be split.");
    }
    const target = await transaction.package.create({
      data: {
        orderId: source.orderId,
        addressId: source.addressId,
        fulfillmentMethodId: source.fulfillmentMethodId,
        recipientName: source.recipientName,
        recipientPhone: source.recipientPhone,
        greeting: source.greeting,
        groupingKey: `${source.groupingKey}:split:${randomUUID()}`,
        packageTypeId: source.packageTypeId,
        version: 1,
      },
    });
    if (sourceLine.quantity === 1) {
      await transaction.packageLine.update({ where: { id: sourceLine.id }, data: { packageId: target.id } });
    } else {
      await transaction.packageLine.update({ where: { id: sourceLine.id }, data: { quantity: { decrement: 1 } } });
      await transaction.packageLine.create({ data: { packageId: target.id, orderLineId: sourceLine.orderLineId, quantity: 1 } });
    }
    const updated = await transaction.package.updateMany({
      where: { id: source.id, version, isActive: true, status: "NEW" },
      data: { version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new Error("This package changed before it could be split.");
    await transaction.packageAudit.createMany({
      data: [
        { packageId: source.id, actorId, action: "package.split", details: { intoPackageId: target.id } },
        { packageId: target.id, actorId, action: "package.created_from_split", details: { sourcePackageId: source.id } },
      ],
    });
    return target;
  });
}

export async function regroupPackages(packageIds: string[], versions: Record<string, number>, actorId: string) {
  return prisma.$transaction(async (transaction) => {
    const packages = await transaction.package.findMany({
      where: {
        id: { in: packageIds },
        isActive: true,
        status: "NEW",
        order: { status: "FINALIZED" },
        OR: packageIds.map((id) => ({ id, version: versions[id] })),
      },
      include: { lines: true },
      orderBy: { createdAt: "asc" },
    });
    const firstPackage = packages[0];
    const sameGrouping = firstPackage && packages.every((packageRecord) =>
      packageRecord.addressId === firstPackage.addressId
      && packageRecord.fulfillmentMethodId === firstPackage.fulfillmentMethodId
      && packageRecord.recipientName === firstPackage.recipientName
      && packageRecord.greeting === firstPackage.greeting,
    );
    if (packages.length !== packageIds.length || packages.length < 2 || new Set(packages.map((packageRecord) => packageRecord.orderId)).size !== 1 || !sameGrouping) {
      throw new Error("Choose two or more new packages from the same order to regroup.");
    }
    const target = packages[0];
    for (const source of packages.slice(1)) {
      for (const line of source.lines) {
        const matchingLine = await transaction.packageLine.findUnique({
          where: { packageId_orderLineId: { packageId: target.id, orderLineId: line.orderLineId } },
        });
        if (matchingLine) {
          await transaction.packageLine.update({ where: { id: matchingLine.id }, data: { quantity: { increment: line.quantity } } });
          await transaction.packageLine.delete({ where: { id: line.id } });
        } else {
          await transaction.packageLine.update({ where: { id: line.id }, data: { packageId: target.id } });
        }
      }
      const deactivated = await transaction.package.updateMany({
        where: { id: source.id, version: versions[source.id], isActive: true, status: "NEW" },
        data: { isActive: false, version: { increment: 1 } },
      });
      if (deactivated.count !== 1) throw new Error("A package changed before it could be regrouped.");
      await transaction.packageAudit.create({
        data: { packageId: source.id, actorId, action: "package.regrouped", details: { intoPackageId: target.id } },
      });
    }
    const updated = await transaction.package.updateMany({
      where: { id: target.id, version: versions[target.id], isActive: true, status: "NEW" },
      data: { version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new Error("The target package changed before it could be regrouped.");
    await transaction.packageAudit.create({
      data: { packageId: target.id, actorId, action: "package.regrouped", details: { sourcePackageIds: packages.slice(1).map((packageRecord) => packageRecord.id) } },
    });
    return target;
  });
}
