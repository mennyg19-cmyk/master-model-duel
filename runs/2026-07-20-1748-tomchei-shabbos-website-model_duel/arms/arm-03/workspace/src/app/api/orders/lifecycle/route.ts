import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse } from "@/lib/api-error";
import { requirePermission } from "@/lib/auth";
import { discardDraft, transitionOrder } from "@/lib/orders/finalize";
import { OrderStatus } from "@prisma/client";
import { recalcOrderPaymentStatus } from "@/lib/payments/offline";
import { db } from "@/lib/db";
import { allowedOrderTransitions } from "@/lib/orders/state-machine";

const bodySchema = z.object({
  orderId: z.string().min(1),
  action: z.enum(["discard", "transition", "recalc_payment"]),
  to: z.nativeEnum(OrderStatus).optional(),
});

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("admin.access");
    const body = bodySchema.parse(await request.json());

    if (body.action === "discard") {
      const result = await discardDraft(body.orderId, staff.effectiveStaff.id);
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
      }
      return NextResponse.json({ ok: true, order: result.value.order });
    }

    if (body.action === "recalc_payment") {
      const status = await recalcOrderPaymentStatus(body.orderId);
      const order = await db.order.findUniqueOrThrow({ where: { id: body.orderId } });
      return NextResponse.json({
        ok: true,
        paymentStatus: status,
        order,
        allowed: allowedOrderTransitions(order.status),
      });
    }

    if (!body.to) {
      return NextResponse.json({ ok: false, error: "to required" }, { status: 400 });
    }
    const result = await transitionOrder(body.orderId, body.to, staff.effectiveStaff.id);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      order: result.value.order,
      allowed: allowedOrderTransitions(result.value.order.status),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
