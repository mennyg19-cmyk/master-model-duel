import { DraftRecipient, Order, OrderLine, Payment, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canAccess, DraftAccess } from "@/lib/orders/drafts";

// Shared order loading for the checkout lifecycle stages (submit, pay,
// webhook, POS). One include shape so every stage sees the same order.

export type OrderForCheckout = Order & {
  lines: OrderLine[];
  recipients: DraftRecipient[];
  payments: Payment[];
  season: { id: string; name: string; status: "OPEN" | "CLOSED" };
};

export const checkoutInclude = {
  lines: true,
  recipients: { orderBy: { createdAt: "asc" as const } },
  payments: true,
  season: true,
  customer: true,
} satisfies Prisma.OrderInclude;

export async function loadAccessibleOrder(
  tx: Prisma.TransactionClient,
  draftRef: string,
  access: DraftAccess,
): Promise<(OrderForCheckout & { customer: { email: string } }) | null> {
  const order = await tx.order.findUnique({ where: { draftRef }, include: checkoutInclude });
  if (!order) return null;
  if (!(await canAccess(order, access))) return null;
  return order;
}

function orderRefForSession(session: {
  client_reference_id?: string | null;
  metadata?: { orderId?: string } | null;
}): { orderId?: string; draftRef?: string } {
  return {
    orderId: session.metadata?.orderId ?? undefined,
    draftRef: session.client_reference_id ?? undefined,
  };
}

export async function findOrderForSession(session: {
  client_reference_id?: string | null;
  metadata?: { orderId?: string } | null;
}) {
  const { orderId, draftRef } = orderRefForSession(session);
  const order = orderId
    ? await prisma.order.findUnique({ where: { id: orderId }, include: checkoutInclude })
    : draftRef
      ? await prisma.order.findUnique({ where: { draftRef }, include: checkoutInclude })
      : null;
  return order;
}
