import { Prisma, type OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

const allowedTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ["FINALIZED", "DISCARDED"],
  FINALIZED: [],
  DISCARDED: [],
};

export function assertOrderTransition(currentStatus: OrderStatus, nextStatus: OrderStatus) {
  if (!allowedTransitions[currentStatus].includes(nextStatus)) {
    throw new Error(`Cannot transition an order from ${currentStatus} to ${nextStatus}.`);
  }
}

export async function finalizeOrder(orderId: string) {
  return prisma.$transaction(async (transaction) => {
    const order = await transaction.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("Order was not found.");
    assertOrderTransition(order.status, "FINALIZED");

    const seasons = await transaction.$queryRaw<{ nextOrderNumber: number; status: string }[]>(
      Prisma.sql`SELECT "nextOrderNumber", "status" FROM "Season" WHERE "id" = ${order.seasonId} FOR UPDATE`,
    );
    const season = seasons[0];
    if (!season) throw new Error("Order season was not found.");
    if (season.status !== "OPEN") {
      throw new Error(`Order season must be OPEN before finalization; current status is ${season.status}.`);
    }

    const claimed = await transaction.order.updateMany({
      where: { id: orderId, status: "DRAFT", version: order.version },
      data: {
        status: "FINALIZED",
        orderNumber: season.nextOrderNumber,
        version: { increment: 1 },
      },
    });
    if (claimed.count !== 1) throw new Error("Order changed before it could be finalized.");

    await transaction.season.update({
      where: { id: order.seasonId },
      data: { nextOrderNumber: { increment: 1 } },
    });

    return transaction.order.findUniqueOrThrow({ where: { id: orderId } });
  });
}

export async function discardOrder(orderId: string) {
  return prisma.$transaction(async (transaction) => {
    const order = await transaction.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("Order was not found.");
    assertOrderTransition(order.status, "DISCARDED");

    const discarded = await transaction.order.updateMany({
      where: { id: orderId, status: "DRAFT", version: order.version },
      data: { status: "DISCARDED", version: { increment: 1 } },
    });
    if (discarded.count !== 1) {
      throw new Error("Order changed before it could be discarded; expected a DRAFT order at its current version.");
    }

    return transaction.order.findUniqueOrThrow({ where: { id: orderId } });
  });
}
