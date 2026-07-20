import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertTransition } from "@/lib/domain/order-state";
import { claimNextOrderNumber } from "@/lib/domain/order-numbers";
import { groupByPackageKey } from "@/lib/domain/grouping";
import { reserveInventory } from "@/lib/domain/inventory";

const lineInclude = {
  product: { include: { inventoryItem: true } },
  addOns: { include: { addOn: { include: { inventoryItem: true } } } },
} satisfies Prisma.OrderLineInclude;

type LineWithInventory = Prisma.OrderLineGetPayload<{ include: typeof lineInclude }>;

// Finalize (R-044..R-046): flip DRAFT->FINALIZED, reserve tracked inventory,
// claim the sequential number, and fold every line into a package. The guarded
// updateMany runs FIRST so the loser of two concurrent finalizations of the
// same order aborts before it touches the Season counter — the counter is
// only ever incremented by the transaction that wins the status flip.
export async function finalizeOrder(orderId: string, actorStaffId?: string, outerTx?: Prisma.TransactionClient) {
  const run = async (tx: Prisma.TransactionClient) => {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { lines: { include: lineInclude } },
    });
    assertTransition(order.status, "FINALIZED");
    if (order.lines.length === 0) {
      throw new Error(`Order ${orderId} has no lines; a finalized order must have at least one`);
    }

    const flipped = await tx.order.updateMany({
      where: { id: orderId, status: "DRAFT" },
      data: { status: "FINALIZED", finalizedAt: new Date() },
    });
    if (flipped.count !== 1) {
      throw new Error(`Order ${orderId} was finalized or discarded by a concurrent request`);
    }

    await reserveLineInventory(tx, order.lines);

    const orderNumber = await claimNextOrderNumber(tx, order.seasonId);
    await tx.order.update({ where: { id: orderId }, data: { orderNumber } });

    await assignLinesToPackages(tx, order.seasonId, order.lines, actorStaffId);
    return tx.order.findUniqueOrThrow({ where: { id: orderId } });
  };
  return outerTx ? run(outerTx) : db.$transaction(run);
}

export async function discardOrder(orderId: string, outerTx?: Prisma.TransactionClient) {
  const run = async (tx: Prisma.TransactionClient) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    assertTransition(order.status, "DISCARDED");
    const flipped = await tx.order.updateMany({
      where: { id: orderId, status: "DRAFT" },
      data: { status: "DISCARDED", discardedAt: new Date() },
    });
    if (flipped.count !== 1) {
      throw new Error(`Order ${orderId} was finalized or discarded by a concurrent request`);
    }
    return tx.order.findUniqueOrThrow({ where: { id: orderId } });
  };
  return outerTx ? run(outerTx) : db.$transaction(run);
}

// Reserve stock for every tracked product / add-on on the order's lines
// (EXPECTED #8). Quantities are aggregated per inventory item first so two
// lines of the same product make one conditional UPDATE; any shortfall throws
// and rolls the whole finalize back (order stays DRAFT, counter untouched).
async function reserveLineInventory(tx: Prisma.TransactionClient, lines: LineWithInventory[]) {
  const needed = new Map<string, { quantity: number; label: string }>();
  const addNeed = (inventoryItemId: string, quantity: number, label: string) => {
    const entry = needed.get(inventoryItemId);
    if (entry) entry.quantity += quantity;
    else needed.set(inventoryItemId, { quantity, label });
  };

  for (const line of lines) {
    if (line.product.trackInventory) {
      if (!line.product.inventoryItem) {
        throw new Error(`Product ${line.product.name} tracks inventory but has no inventory item`);
      }
      addNeed(line.product.inventoryItem.id, line.quantity, line.product.name);
    }
    for (const lineAddOn of line.addOns) {
      if (!lineAddOn.addOn.trackInventory) continue;
      if (!lineAddOn.addOn.inventoryItem) {
        throw new Error(`Add-on ${lineAddOn.addOn.name} tracks inventory but has no inventory item`);
      }
      addNeed(lineAddOn.addOn.inventoryItem.id, lineAddOn.quantity, lineAddOn.addOn.name);
    }
  }

  for (const [inventoryItemId, need] of needed) {
    const reserved = await reserveInventory(tx, inventoryItemId, need.quantity);
    if (!reserved) {
      throw new Error(`Insufficient stock for ${need.label}: ${need.quantity} requested`);
    }
  }
}

// Lines merge into an existing still-NEW package with the same grouping key
// (same recipient/address/method/greeting, possibly from an earlier order in
// the season) or open a new one. Every merge/create writes package audit.
//
// Concurrency: two finalizations of DIFFERENT orders sharing a grouping key
// must not both create a NEW package. A per-(season, key) advisory xact lock
// serializes the find-or-create; keys are locked in sorted order so two
// multi-key orders can never deadlock. The partial unique index
// Package_seasonId_groupingKey_new_key backstops the invariant at the DB layer.
async function assignLinesToPackages(
  tx: Prisma.TransactionClient,
  seasonId: string,
  lines: LineWithInventory[],
  actorStaffId?: string
) {
  const byKey = groupByPackageKey(lines);
  const sortedKeys = [...byKey.keys()].sort();

  for (const groupingKey of sortedKeys) {
    const groupLines = byKey.get(groupingKey)!;
    const sample = groupLines[0];
    // ::text because Prisma cannot deserialize the function's void return.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${seasonId}|${groupingKey}`}, 0))::text`;
    const existing = await tx.package.findFirst({
      where: { seasonId, groupingKey, stage: "NEW" },
      orderBy: { createdAt: "asc" },
    });
    const target =
      existing ??
      (await tx.package.create({
        data: {
          seasonId,
          groupingKey,
          recipientName: sample.recipientName,
          addressLine1: sample.addressLine1,
          addressLine2: sample.addressLine2,
          city: sample.city,
          state: sample.state,
          zip: sample.zip,
          fulfillmentMethodId: sample.fulfillmentMethodId,
          greeting: sample.greeting,
        },
      }));

    await tx.orderLine.updateMany({
      where: { id: { in: groupLines.map((line) => line.id) } },
      data: { packageId: target.id },
    });
    await tx.packageAudit.create({
      data: {
        packageId: target.id,
        actorStaffId,
        action: existing ? "lines_merged" : "package_created",
        detail: { orderLineIds: groupLines.map((line) => line.id) },
      },
    });
  }
}
