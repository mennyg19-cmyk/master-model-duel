import { PaymentMethod } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { recalculatePaymentStatus } from "@/domain/checkout";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

const postPaymentSchema = z.object({
  method: z.enum([PaymentMethod.CASH, PaymentMethod.CHECK]),
  amountCents: z.number().int().positive(),
  reference: z.string().trim().min(1).max(120),
});
const voidPaymentSchema = z.object({ paymentId: z.string().min(1) });

function paymentError(error: unknown) {
  if (error instanceof AccessDeniedError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  throw error;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  try {
    const staffSession = await requirePermission("payments:manage");
    const parsed = postPaymentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Cash or check payment details are invalid." },
        { status: 400 },
      );
    }
    const { orderId } = await context.params;
    const payment = await db.$transaction(async (transaction) => {
      const order = await transaction.order.findUnique({ where: { id: orderId } });
      if (!order || order.status === "CANCELLED") {
        throw new Error("Payment requires an active draft or finalized order.");
      }
      if (order.status === "DRAFT") {
        const season = await transaction.season.update({
          where: { id: order.seasonId },
          data: { nextOrderNumber: { increment: 1 } },
          select: { nextOrderNumber: true },
        });
        await transaction.order.update({
          where: { id: order.id },
          data: {
            status: "FINALIZED",
            orderNumber: season.nextOrderNumber - 1,
            finalizedAt: new Date(),
            version: { increment: 1 },
          },
        });
      }
      const createdPayment = await transaction.payment.create({
        data: {
          orderId,
          method: parsed.data.method,
          amountCents: parsed.data.amountCents,
          reference: parsed.data.reference,
          postedByStaffId: staffSession.actor.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorStaffId: staffSession.actor.id,
          action: "payment.offline_posted",
          targetType: "Payment",
          targetId: createdPayment.id,
          metadata: {
            orderId,
            method: parsed.data.method,
            amountCents: parsed.data.amountCents,
          },
        },
      });
      return createdPayment;
    });
    const cachedPaymentStatus = await recalculatePaymentStatus(db, orderId);
    return NextResponse.json({ payment, cachedPaymentStatus }, { status: 201 });
  } catch (error) {
    return paymentError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  try {
    const staffSession = await requirePermission("payments:manage");
    const parsed = voidPaymentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Payment ID is required." }, { status: 400 });
    }
    const { orderId } = await context.params;
    const payment = await db.$transaction(async (transaction) => {
      const voided = await transaction.payment.updateMany({
        where: {
          id: parsed.data.paymentId,
          orderId,
          method: { in: [PaymentMethod.CASH, PaymentMethod.CHECK] },
          status: "POSTED",
        },
        data: {
          status: "VOIDED",
          voidedAt: new Date(),
          voidedByStaffId: staffSession.actor.id,
        },
      });
      if (voided.count !== 1) return null;
      await transaction.auditLog.create({
        data: {
          actorStaffId: staffSession.actor.id,
          action: "payment.offline_voided",
          targetType: "Payment",
          targetId: parsed.data.paymentId,
          metadata: { orderId },
        },
      });
      return transaction.payment.findUnique({ where: { id: parsed.data.paymentId } });
    });
    if (!payment) {
      return NextResponse.json(
        { error: "Posted cash or check payment was not found." },
        { status: 404 },
      );
    }
    const cachedPaymentStatus = await recalculatePaymentStatus(db, orderId);
    return NextResponse.json({ payment, cachedPaymentStatus });
  } catch (error) {
    return paymentError(error);
  }
}
