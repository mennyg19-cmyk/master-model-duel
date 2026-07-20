import { OrderStatus, Prisma, PrismaClient } from "@prisma/client";
import { materializeOrderPackages } from "@/domain/package-operations";

const ALLOWED_ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  DRAFT: [OrderStatus.FINALIZED, OrderStatus.CANCELLED],
  FINALIZED: [OrderStatus.CANCELLED],
  CANCELLED: [],
};

export function assertOrderTransition(from: OrderStatus, to: OrderStatus) {
  if (!ALLOWED_ORDER_TRANSITIONS[from].includes(to)) {
    throw new Error(`Order cannot transition from ${from} to ${to}.`);
  }
}

export function formatDraftReference(sequence: number) {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("Draft reference sequence must be a positive integer.");
  }

  return `D-${sequence.toString().padStart(8, "0")}`;
}

async function claimOrderNumber(prisma: PrismaClient, orderId: string) {
  return prisma.$transaction(
    async (transaction) => {
      const order = await transaction.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { id: true, seasonId: true, status: true, orderNumber: true },
      });

      if (order.status === OrderStatus.FINALIZED && order.orderNumber !== null) {
        return order.orderNumber;
      }
      assertOrderTransition(order.status, OrderStatus.FINALIZED);

      const season = await transaction.season.update({
        where: { id: order.seasonId },
        data: { nextOrderNumber: { increment: 1 } },
        select: { nextOrderNumber: true },
      });
      const orderNumber = season.nextOrderNumber - 1;
      const claimed = await transaction.order.updateMany({
        where: { id: order.id, status: OrderStatus.DRAFT, orderNumber: null },
        data: {
          status: OrderStatus.FINALIZED,
          orderNumber,
          finalizedAt: new Date(),
          version: { increment: 1 },
        },
      });

      if (claimed.count !== 1) {
        throw new Error("Order finalization lost a concurrent update.");
      }

      return orderNumber;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function finalizeOrder(prisma: PrismaClient, orderId: string) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const orderNumber = await claimOrderNumber(prisma, orderId);
      await prisma.$transaction((transaction) =>
        materializeOrderPackages(transaction, orderId),
      );
      return orderNumber;
    } catch (error) {
      const canRetry =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < 3;
      if (!canRetry) {
        throw error;
      }
    }
  }

  throw new Error("Order finalization exhausted its concurrency retries.");
}

export async function discardDraft(prisma: PrismaClient, orderId: string) {
  const discarded = await prisma.order.updateMany({
    where: { id: orderId, status: OrderStatus.DRAFT },
    data: {
      status: OrderStatus.CANCELLED,
      discardedAt: new Date(),
      version: { increment: 1 },
    },
  });

  if (discarded.count !== 1) {
    throw new Error("Only an existing draft order can be discarded.");
  }
}
