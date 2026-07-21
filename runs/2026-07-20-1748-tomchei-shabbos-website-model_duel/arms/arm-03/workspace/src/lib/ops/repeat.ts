import { AuditAction, OrderStatus, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { err, maskError, ok, type Result } from "@/lib/result";
import { formatDraftRef } from "@/lib/orders/draft-wire";
import { writeAudit } from "@/lib/audit";
import { randomBytes } from "node:crypto";

type Tx = Prisma.TransactionClient;

async function cloneLines(
  tx: Tx,
  sourceOrderId: string,
  targetOrderId: string,
) {
  const lines = await tx.orderLine.findMany({
    where: { orderId: sourceOrderId },
    include: { addOns: true },
    orderBy: { createdAt: "asc" },
  });

  for (const line of lines) {
    const created = await tx.orderLine.create({
      data: {
        orderId: targetOrderId,
        productId: line.productId,
        productOptionId: line.productOptionId,
        quantity: line.quantity,
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
        groupingKey: line.groupingKey || "unassigned",
      },
    });
    for (const addOn of line.addOns) {
      await tx.orderLineAddOn.create({
        data: {
          orderLineId: created.id,
          addOnId: addOn.addOnId,
          quantity: addOn.quantity,
          unitPriceCents: addOn.unitPriceCents,
        },
      });
    }
  }
}

/** Repeat one paid/placed order into a new draft (R-057 groundwork). */
export async function repeatOrder(input: {
  sourceOrderId: string;
  staffId: string;
}): Promise<Result<{ draftRef: string; orderId: string }>> {
  try {
    const source = await db.order.findUniqueOrThrow({
      where: { id: input.sourceOrderId },
    });
    if (
      source.status === OrderStatus.DRAFT ||
      source.status === OrderStatus.DISCARDED
    ) {
      return err("status", "Cannot repeat a draft or discarded order.");
    }

    const season = await db.season.findUniqueOrThrow({ where: { id: source.seasonId } });
    const draftRef = formatDraftRef(season.year, randomBytes(6).toString("hex"));
    const created = await db.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          seasonId: source.seasonId,
          customerId: source.customerId,
          status: OrderStatus.DRAFT,
          draftRef,
          greetingDefault: source.greetingDefault,
        },
      });
      await cloneLines(tx, source.id, order.id);
      await tx.auditLog.create({
        data: {
          action: AuditAction.ORDER_REPEATED,
          actorId: input.staffId,
          meta: {
            sourceOrderId: source.id,
            newOrderId: order.id,
            draftRef,
            mode: "single",
          },
        },
      });
      return order;
    });

    return ok({ draftRef: created.draftRef, orderId: created.id });
  } catch (error) {
    return err(maskError(error), "Could not repeat order.");
  }
}

const MAX_BULK_REPEAT = 25;

/** Bounded bulk-repeat with optimistic version conflict reporting. */
export async function bulkRepeatOrders(input: {
  items: Array<{ orderId: string; expectedVersion: number }>;
  staffId: string;
}): Promise<
  Result<{
    created: Array<{ sourceOrderId: string; draftRef: string; orderId: string }>;
    conflicts: Array<{ orderId: string; reason: string; actualVersion?: number }>;
    skipped: Array<{ orderId: string; reason: string }>;
  }>
> {
  if (input.items.length === 0) {
    return err("empty", "Provide at least one order.");
  }
  if (input.items.length > MAX_BULK_REPEAT) {
    return err("bound", `Bulk repeat capped at ${MAX_BULK_REPEAT}.`);
  }

  try {
    const created: Array<{ sourceOrderId: string; draftRef: string; orderId: string }> = [];
    const conflicts: Array<{ orderId: string; reason: string; actualVersion?: number }> = [];
    const skipped: Array<{ orderId: string; reason: string }> = [];

    for (const item of input.items) {
      const source = await db.order.findUnique({ where: { id: item.orderId } });
      if (!source) {
        skipped.push({ orderId: item.orderId, reason: "not_found" });
        continue;
      }
      if (
        source.status === OrderStatus.DRAFT ||
        source.status === OrderStatus.DISCARDED
      ) {
        skipped.push({ orderId: item.orderId, reason: `status_${source.status}` });
        continue;
      }
      if (source.version !== item.expectedVersion) {
        conflicts.push({
          orderId: item.orderId,
          reason: "version_conflict",
          actualVersion: source.version,
        });
        continue;
      }

      const seasonRow = await db.season.findUniqueOrThrow({ where: { id: source.seasonId } });
      const draftRef = formatDraftRef(seasonRow.year, randomBytes(6).toString("hex"));
      const order = await db.$transaction(async (tx) => {
        // Re-check version under transaction for concurrency.
        const locked = await tx.order.findUniqueOrThrow({ where: { id: source.id } });
        if (locked.version !== item.expectedVersion) {
          return null;
        }
        const draft = await tx.order.create({
          data: {
            seasonId: locked.seasonId,
            customerId: locked.customerId,
            status: OrderStatus.DRAFT,
            draftRef,
            greetingDefault: locked.greetingDefault,
          },
        });
        await cloneLines(tx, locked.id, draft.id);
        await tx.order.update({
          where: { id: locked.id },
          data: { version: { increment: 1 } },
        });
        return draft;
      });

      if (!order) {
        const fresh = await db.order.findUnique({ where: { id: item.orderId } });
        conflicts.push({
          orderId: item.orderId,
          reason: "version_conflict",
          actualVersion: fresh?.version,
        });
        continue;
      }

      created.push({
        sourceOrderId: item.orderId,
        draftRef: order.draftRef,
        orderId: order.id,
      });
    }

    await writeAudit({
      action: AuditAction.BULK_ACTION_APPLIED,
      actorId: input.staffId,
      meta: {
        action: "bulk_repeat",
        createdCount: created.length,
        conflictCount: conflicts.length,
        skippedCount: skipped.length,
        created,
        conflicts,
        skipped,
      },
    });

    return ok({ created, conflicts, skipped });
  } catch (error) {
    return err(maskError(error), "Bulk repeat failed.");
  }
}

/** Generic bulk action with deterministic conflict reporting (G-024). */
export async function bulkUpdateOrderStatus(input: {
  items: Array<{ orderId: string; expectedVersion: number }>;
  toStatus: OrderStatus;
  staffId: string;
}): Promise<
  Result<{
    updated: string[];
    conflicts: Array<{ orderId: string; reason: string; actualVersion?: number }>;
    skipped: Array<{ orderId: string; reason: string }>;
  }>
> {
  const allowed = new Set<OrderStatus>([
    OrderStatus.CANCELLED,
    OrderStatus.FULFILLING,
    OrderStatus.COMPLETED,
  ]);
  if (!allowed.has(input.toStatus)) {
    return err("status", `Bulk status ${input.toStatus} not allowed.`);
  }
  if (input.items.length > 100) {
    return err("bound", "Bulk status capped at 100.");
  }

  try {
    const updated: string[] = [];
    const conflicts: Array<{ orderId: string; reason: string; actualVersion?: number }> = [];
    const skipped: Array<{ orderId: string; reason: string }> = [];

    for (const item of input.items) {
      const result = await db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({ where: { id: item.orderId } });
        if (!order) return { kind: "skipped" as const, reason: "not_found" };
        if (order.version !== item.expectedVersion) {
          return {
            kind: "conflict" as const,
            reason: "version_conflict",
            actualVersion: order.version,
          };
        }
        if (
          order.status === OrderStatus.DRAFT ||
          order.status === OrderStatus.DISCARDED
        ) {
          return { kind: "skipped" as const, reason: `status_${order.status}` };
        }
        await tx.order.update({
          where: { id: order.id },
          data: { status: input.toStatus, version: { increment: 1 } },
        });
        return { kind: "updated" as const };
      });

      if (result.kind === "updated") updated.push(item.orderId);
      else if (result.kind === "conflict") {
        conflicts.push({
          orderId: item.orderId,
          reason: result.reason,
          actualVersion: result.actualVersion,
        });
      } else {
        skipped.push({ orderId: item.orderId, reason: result.reason });
      }
    }

    await writeAudit({
      action: AuditAction.BULK_ACTION_APPLIED,
      actorId: input.staffId,
      meta: {
        action: "bulk_status",
        toStatus: input.toStatus,
        updated,
        conflicts,
        skipped,
      },
    });

    return ok({ updated, conflicts, skipped });
  } catch (error) {
    return err(maskError(error), "Bulk status update failed.");
  }
}
