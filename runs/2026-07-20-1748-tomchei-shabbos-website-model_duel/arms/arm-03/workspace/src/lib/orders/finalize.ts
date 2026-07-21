import {

  AuditAction,

  OrderStatus,

  PackageStage,

  type Order,

  type Prisma,

} from "@prisma/client";

import { db } from "@/lib/db";

import { err, maskError, ok, type Result } from "@/lib/result";

import { reserveInventoryWithClient } from "@/lib/inventory/reserve";

import { groupLinesByKey } from "@/lib/orders/grouping";

import { lockOrderForUpdate } from "@/lib/orders/lock";

import { assertOrderTransition } from "@/lib/orders/state-machine";



type Tx = Prisma.TransactionClient;



async function claimNextOrderNumber(

  tx: Tx,

  seasonId: string,

): Promise<number> {

  const rows = await tx.$queryRaw<Array<{ nextOrderNumber: number }>>`

    SELECT "nextOrderNumber"

    FROM "Season"

    WHERE id = ${seasonId}

    FOR UPDATE

  `;

  const current = rows[0]?.nextOrderNumber;

  if (current == null) {

    throw new Error(`Season ${seasonId} not found while claiming order number`);

  }

  await tx.season.update({

    where: { id: seasonId },

    data: { nextOrderNumber: current + 1 },

  });

  return current;

}



async function materializePackages(

  tx: Tx,

  orderId: string,

  actorId?: string | null,

): Promise<number> {

  const existing = await tx.package.count({ where: { orderId } });

  if (existing > 0) {

    throw new Error(`Order ${orderId} already has packages`);

  }



  const lines = await tx.orderLine.findMany({

    where: { orderId },

    include: { fulfillmentMethod: true },

  });

  if (lines.length === 0) {

    throw new Error(`Order ${orderId} has no lines to package`);

  }

  for (const line of lines) {
    if (!line.recipientName || !line.addressLine1 || !line.city || !line.state || !line.postalCode || !line.fulfillmentMethodId) {
      throw new Error(`Order ${orderId} has unassigned cart lines`);
    }
  }

  const groups = groupLinesByKey(lines);

  let created = 0;

  for (const [groupingKey, groupLines] of groups) {

    const head = groupLines[0];

    if (!head) continue;
    if (!head.recipientName || !head.addressLine1 || !head.city || !head.state || !head.postalCode || !head.fulfillmentMethodId) {
      throw new Error(`Order ${orderId} has unassigned cart lines`);
    }

    await tx.package.create({

      data: {

        orderId,

        groupingKey,

        recipientName: head.recipientName,

        addressLine1: head.addressLine1,

        addressLine2: head.addressLine2,

        city: head.city,

        state: head.state,

        postalCode: head.postalCode,

        country: head.country ?? "US",

        savedAddressId: head.savedAddressId,

        fulfillmentMethodId: head.fulfillmentMethodId,

        greeting: head.greeting,

        stage: PackageStage.NEW,

        items: {

          create: groupLines.map((line) => ({

            orderLineId: line.id,

            quantity: line.quantity,

          })),

        },

        audits: {

          create: {

            actorId: actorId ?? null,

            fromStage: null,

            toStage: PackageStage.NEW,

            note: "Materialized on finalize",

          },

        },

      },

    });

    created += 1;

  }

  return created;

}



async function reserveOrderInventory(

  tx: Tx,

  orderId: string,

  actorId?: string | null,

): Promise<void> {

  const lines = await tx.orderLine.findMany({

    where: { orderId },

    include: {

      product: true,

      addOns: { include: { addOn: true } },

    },

  });



  type Need = { inventoryItemId: string; quantity: number };

  const needs = new Map<string, number>();



  const addNeed = (inventoryItemId: string, quantity: number) => {

    needs.set(inventoryItemId, (needs.get(inventoryItemId) ?? 0) + quantity);

  };



  for (const line of lines) {

    if (line.product.tracksInventory) {

      const item = await tx.inventoryItem.findUnique({

        where: { productId: line.productId },

      });

      if (!item) {

        throw new Error(

          `No inventory row for tracked product ${line.product.sku}`,

        );

      }

      addNeed(item.id, line.quantity);

    }



    for (const lineAddOn of line.addOns) {

      if (!lineAddOn.addOn.tracksInventory) continue;

      const item = await tx.inventoryItem.findUnique({

        where: { addOnId: lineAddOn.addOnId },

      });

      if (!item) {

        throw new Error(

          `No inventory row for tracked add-on ${lineAddOn.addOn.sku}`,

        );

      }

      addNeed(item.id, lineAddOn.quantity);

    }

  }



  const reserveList: Need[] = [...needs.entries()].map(

    ([inventoryItemId, quantity]) => ({ inventoryItemId, quantity }),

  );

  for (const need of reserveList) {

    await reserveInventoryWithClient(tx, {

      inventoryItemId: need.inventoryItemId,

      quantity: need.quantity,

      actorId,

    });

  }

}



/** Shared finalize/discard/transition error envelope (CC-F1/CC-F2). */

async function runOrderMutation<T>(

  publicMessage: string,

  work: (tx: Tx) => Promise<T>,

): Promise<Result<T>> {

  try {

    const value = await db.$transaction((tx) => work(tx));

    return ok(value);

  } catch (error) {

    return err(maskError(error), publicMessage);

  }

}



export async function finalizeOrder(

  orderId: string,

  actorId?: string | null,

): Promise<Result<{ order: Order; orderNumber: number; packageCount: number }>> {

  return runOrderMutation("Could not finalize order.", async (tx) => {

    // Lock draft first — claim order number only after we own the row (R-2).

    const order = await lockOrderForUpdate(tx, orderId);

    assertOrderTransition(order.status, OrderStatus.PLACED);



    const orderNumber = await claimNextOrderNumber(tx, order.seasonId);

    const updated = await tx.order.update({

      where: { id: orderId, version: order.version, status: OrderStatus.DRAFT },

      data: {

        status: OrderStatus.PLACED,

        orderNumber,

        placedAt: new Date(),

        version: { increment: 1 },

      },

    });



    const packageCount = await materializePackages(tx, orderId, actorId);

    await reserveOrderInventory(tx, orderId, actorId);



    await tx.auditLog.create({

      data: {

        action: AuditAction.ORDER_FINALIZED,

        actorId: actorId ?? null,

        meta: {

          orderId,

          orderNumber,

          draftRef: order.draftRef,

          packageCount,

        },

      },

    });



    return { order: updated, orderNumber, packageCount };

  });

}



export async function discardDraft(

  orderId: string,

  actorId?: string | null,

): Promise<Result<{ order: Order }>> {

  return runOrderMutation("Could not discard draft.", async (tx) => {

    const order = await lockOrderForUpdate(tx, orderId);

    assertOrderTransition(order.status, OrderStatus.DISCARDED);



    const updated = await tx.order.update({

      where: { id: orderId, version: order.version, status: OrderStatus.DRAFT },

      data: {

        status: OrderStatus.DISCARDED,

        discardedAt: new Date(),

        version: { increment: 1 },

      },

    });



    await tx.auditLog.create({

      data: {

        action: AuditAction.ORDER_DISCARDED,

        actorId: actorId ?? null,

        meta: { orderId, draftRef: order.draftRef },

      },

    });



    return { order: updated };

  });

}



export async function transitionOrder(

  orderId: string,

  to: OrderStatus,

  actorId?: string | null,

): Promise<Result<{ order: Order }>> {

  return runOrderMutation("Could not transition order.", async (tx) => {

    const order = await lockOrderForUpdate(tx, orderId);

    assertOrderTransition(order.status, to);



    const updated = await tx.order.update({

      where: { id: orderId, version: order.version },

      data: {

        status: to,

        version: { increment: 1 },

      },

    });



    await tx.auditLog.create({

      data: {

        action: AuditAction.ORDER_TRANSITIONED,

        actorId: actorId ?? null,

        meta: { orderId, from: order.status, to },

      },

    });



    return { order: updated };

  });

}


