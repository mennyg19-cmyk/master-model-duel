import type { OrderPaymentStatus, Prisma } from "@prisma/client";

// Recomputes the cached payment status (R-152) from posted payments. Voided
// payments don't count. A comp payment covering the total marks COMPED.
export async function recalcPaymentStatus(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<OrderPaymentStatus> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { payments: { where: { state: "POSTED" } } },
  });

  const postedTotal = order.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const compTotal = order.payments
    .filter((payment) => payment.method === "COMP")
    .reduce((sum, payment) => sum + payment.amountCents, 0);

  let status: OrderPaymentStatus;
  if (postedTotal <= 0) status = "UNPAID";
  else if (postedTotal < order.totalCents) status = "PARTIAL";
  else status = compTotal >= order.totalCents ? "COMPED" : "PAID";

  await tx.order.update({ where: { id: orderId }, data: { paymentStatus: status } });
  return status;
}
