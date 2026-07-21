import type { Order, Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Row-lock an order before mutating (prevents burned order numbers / TOCTOU). */
export async function lockOrderForUpdate(
  tx: Tx,
  orderId: string,
): Promise<Order> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new Error(`Order ${orderId} not found`);
  }
  return tx.order.findUniqueOrThrow({ where: { id: orderId } });
}
