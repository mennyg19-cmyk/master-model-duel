import type { Prisma, PrismaClient } from "@prisma/client";
import { enqueueTransactionalEmail } from "@/domain/messaging-templates";

type MessageClient = PrismaClient | Prisma.TransactionClient;

export async function enqueueRefundEmail(
  prisma: MessageClient,
  order: {
    id: string;
    orderNumber: number | null;
    draftReference: string;
    customer: { id: string; email: string | null };
  },
  payment: { id: string; refundedCents: number },
  amountCents: number,
) {
  const cumulativeRefundedCents = payment.refundedCents + amountCents;
  return enqueueTransactionalEmail(prisma, {
    idempotencyKey: `refund:${payment.id}:${cumulativeRefundedCents}`,
    templateKey: "order.refund",
    recipient: order.customer.email,
    variables: {
      orderNumber: order.orderNumber ?? order.draftReference,
      refundAmount: `$${(amountCents / 100).toFixed(2)}`,
    },
    customerId: order.customer.id,
    orderId: order.id,
  });
}

export async function sendPaymentReminders(prisma: PrismaClient) {
  const orders = await prisma.order.findMany({
    where: {
      status: "FINALIZED",
      cachedPaymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] },
      customer: { email: { not: null } },
    },
    include: { customer: true },
    take: 500,
  });
  for (const order of orders) {
    await enqueueTransactionalEmail(prisma, {
      idempotencyKey: `payment-reminder:${order.id}:${new Date()
        .toISOString()
        .slice(0, 10)}`,
      templateKey: "order.payment_link",
      recipient: order.customer.email,
      customerId: order.customer.id,
      orderId: order.id,
      variables: {
        orderNumber: order.orderNumber ?? order.draftReference,
        paymentUrl: `${
          process.env.APP_URL ?? "http://127.0.0.1:3101"
        }/account/orders/${order.id}`,
      },
    });
  }
  return orders.length;
}
