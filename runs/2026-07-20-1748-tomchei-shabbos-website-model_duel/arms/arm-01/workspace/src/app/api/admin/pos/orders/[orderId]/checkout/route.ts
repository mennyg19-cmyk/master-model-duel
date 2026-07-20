import { PaymentMethod, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CheckoutConflictError,
  finalizePosOrder,
  prepareCheckout,
  recalculatePaymentStatus,
} from "@/domain/checkout";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDeliveryZips } from "@/lib/store-settings";

const checkoutSchema = z.object({
  method: z.enum([PaymentMethod.CASH, PaymentMethod.CHECK]),
  reference: z.string().trim().min(1).max(120),
  choices: z.array(z.object({
    orderLineId: z.string().min(1),
    fulfillmentCode: z.enum(["BULK_DELIVERY", "PACKAGE_DELIVERY", "SHIPPING", "PICKUP"]),
    greeting: z.string().trim().min(1).max(500),
    deliveryDay: z.string().nullable().optional(),
  })).min(1).max(100),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  try {
    const session = await requirePermission("payments:manage");
    const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "POS checkout details are invalid." }, { status: 400 });
    }
    const { orderId } = await context.params;
    await prepareCheckout(
      db,
      orderId,
      parsed.data.choices,
      parsed.data.choices[0]?.greeting ?? "",
      0,
      await getDeliveryZips(),
    );
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { totalCents: true },
    });
    const payment = await db.$transaction(
      async (transaction) => {
        await finalizePosOrder(transaction, orderId);
        const created = await transaction.payment.create({
          data: {
            orderId,
            method: parsed.data.method,
            amountCents: order.totalCents,
            reference: parsed.data.reference,
            postedByStaffId: session.actor.id,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorStaffId: session.actor.id,
            action: "pos.order_paid",
            targetType: "Payment",
            targetId: created.id,
            metadata: { orderId, method: created.method, amountCents: created.amountCents },
          },
        });
        await recalculatePaymentStatus(transaction, orderId);
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return NextResponse.json({ payment }, { status: 201 });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof CheckoutConflictError) {
      return NextResponse.json({ error: error.message, conflicts: error.conflicts }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "That payment reference was already used." }, { status: 409 });
    }
    throw error;
  }
}
