import { NextResponse } from "next/server";
import { z } from "zod";
import { OrderStatus } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { bulkRepeatOrders, bulkUpdateOrderStatus } from "@/lib/ops/repeat";

const itemSchema = z.object({
  orderId: z.string().min(1),
  expectedVersion: z.number().int().nonnegative(),
});

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("repeat"),
    items: z.array(itemSchema).min(1).max(25),
    confirmReplacements: z.literal(true),
    confirmRecipients: z.literal(true),
  }),
  z.object({
    action: z.literal("status"),
    toStatus: z.nativeEnum(OrderStatus),
    items: z.array(itemSchema).min(1).max(100),
  }),
]);

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("admin.access");
    const body = bodySchema.parse(await request.json());

    if (body.action === "repeat") {
      const result = await bulkRepeatOrders({
        items: body.items,
        staffId: staff.effectiveStaff.id,
        confirmReplacements: body.confirmReplacements,
        confirmRecipients: body.confirmRecipients,
      });
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
      }
      return NextResponse.json({ ok: true, ...result.value });
    }

    const result = await bulkUpdateOrderStatus({
      items: body.items,
      toStatus: body.toStatus,
      staffId: staff.effectiveStaff.id,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...result.value });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
