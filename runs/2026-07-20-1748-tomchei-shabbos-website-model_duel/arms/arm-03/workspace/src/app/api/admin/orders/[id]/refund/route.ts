import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { refundPayment } from "@/lib/ops/refunds";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  paymentId: z.string().min(1),
  amountCents: z.number().int().positive(),
  reason: z.string().max(500).optional(),
});

export async function POST(request: Request, ctx: Ctx) {
  try {
    const staff = await requirePermission("admin.access");
    const { id: orderId } = await ctx.params;
    const body = bodySchema.parse(await request.json());
    const result = await refundPayment({
      paymentId: body.paymentId,
      orderId,
      amountCents: body.amountCents,
      staffId: staff.effectiveStaff.id,
      reason: body.reason,
    });
    if (!result.ok) {
      const status = result.error === "order" ? 400 : 409;
      return NextResponse.json(
        { ok: false, error: result.publicMessage },
        { status },
      );
    }
    return NextResponse.json({
      ok: true,
      payment: result.value.payment,
      paymentStatus: result.value.paymentStatus,
      stripeRefundId: result.value.stripeRefundId,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
