import type { Order, Payment, Prisma } from "@prisma/client";

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

/** Acquire FOR UPDATE on a Package row (caller loads with desired include after). */
export async function lockPackageRow(tx: Tx, packageId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Package" WHERE id = ${packageId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new Error(`Package ${packageId} not found`);
  }
}

/**
 * Season-scope then row-lock a package. Callers findUniqueOrThrow with their include.
 */
export async function requirePackageInSeasonLocked(
  tx: Tx,
  packageId: string,
  seasonId: string,
): Promise<void> {
  const scoped = await tx.package.findFirst({
    where: { id: packageId, order: { seasonId } },
    select: { id: true },
  });
  if (!scoped) {
    throw new Error(`Package ${packageId} not found`);
  }
  await lockPackageRow(tx, packageId);
}

/** Row-lock a payment before refund claim / compensate. */
export async function lockPaymentForUpdate(
  tx: Tx,
  paymentId: string,
): Promise<Payment> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new Error(`Payment ${paymentId} not found`);
  }
  return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
}
