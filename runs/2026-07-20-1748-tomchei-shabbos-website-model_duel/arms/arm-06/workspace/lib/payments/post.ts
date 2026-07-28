import { Payment, PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";
import { prisma, reloadOrThrow } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";

// R-160: payments post and void; the order's paymentStatus is a cache of
// sum(posted) vs total, recomputed inside the same transaction.
export async function postPayment(input: {
  orderId: string;
  method: PaymentMethod;
  amountCents: number;
  postedById?: string;
}): Promise<Payment> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new DomainRuleError(`amountCents must be a positive integer; got ${input.amountCents}`);
  }
  return prisma.$transaction(async (tx) => {
    // Payments only exist against submitted orders (R-160): posting on a DRAFT
    // inflates a cart, posting on a DISCARDED order resurrects its status.
    await requireFinalizedOrder(tx, input.orderId);
    const payment = await tx.payment.create({
      data: {
        orderId: input.orderId,
        method: input.method,
        amountCents: input.amountCents,
        postedById: input.postedById ?? null,
      },
    });
    await recomputePaymentStatus(tx, input.orderId);
    return payment;
  });
}

export async function voidPayment(paymentId: string, voidReason?: string): Promise<Payment> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!existing) throw new NotFoundError("Payment", paymentId);
    await requireFinalizedOrder(tx, existing.orderId);
    const updated = await tx.payment.updateMany({
      where: { id: paymentId, status: "POSTED" },
      data: { status: "VOIDED", voidedAt: new Date(), voidReason: voidReason ?? null },
    });
    if (updated.count === 0) {
      throw new DomainRuleError(`Payment ${paymentId} is already voided; expected POSTED`);
    }
    const payment = await reloadOrThrow(
      () => tx.payment.findUnique({ where: { id: paymentId } }),
      "Payment",
      paymentId,
    );
    await recomputePaymentStatus(tx, payment.orderId);
    return payment;
  });
}

async function requireFinalizedOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) throw new NotFoundError("Order", orderId);
  if (order.status !== "FINALIZED") {
    throw new DomainRuleError(`Order ${orderId} is ${order.status}; expected FINALIZED for payments`);
  }
}

export function classifyPaymentStatus(paidCents: number, totalCents: number): PaymentStatus {
  if (paidCents <= 0) return "UNPAID";
  if (paidCents < totalCents) return "PARTIAL";
  if (paidCents === totalCents) return "PAID";
  return "OVERPAID";
}

async function recomputePaymentStatus(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<PaymentStatus> {
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) throw new NotFoundError("Order", orderId);
  const posted = await tx.payment.aggregate({
    where: { orderId, status: "POSTED" },
    _sum: { amountCents: true },
  });
  const status = classifyPaymentStatus(posted._sum.amountCents ?? 0, order.totalCents);
  await tx.order.update({ where: { id: orderId }, data: { paymentStatus: status } });
  return status;
}
