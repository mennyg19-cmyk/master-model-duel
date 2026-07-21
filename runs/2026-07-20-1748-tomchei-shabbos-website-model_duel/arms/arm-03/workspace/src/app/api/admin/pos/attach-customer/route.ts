import { NextResponse } from "next/server";
import { z } from "zod";
import { OrderStatus } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { db } from "@/lib/db";
import { assertCanMutateDraft } from "@/lib/orders/draft-access";
import { draftInclude, serializeDraft } from "@/lib/orders/drafts";

const bodySchema = z.object({
  draftRef: z.string().min(1),
  customerId: z.string().min(1),
});

/** Attach walk-in customer to POS draft (R-060). */
export async function POST(request: Request) {
  try {
    await requirePermission("admin.access");
    const body = bodySchema.parse(await request.json());
    const { order } = await assertCanMutateDraft(body.draftRef, request);
    if (order.status !== OrderStatus.DRAFT) {
      return NextResponse.json({ ok: false, error: "Draft required" }, { status: 409 });
    }
    const customer = await db.customer.findUnique({ where: { id: body.customerId } });
    if (!customer) {
      return NextResponse.json({ ok: false, error: "Customer not found" }, { status: 404 });
    }
    await db.order.update({
      where: { id: order.id },
      data: { customerId: customer.id, version: { increment: 1 } },
    });
    const full = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: draftInclude,
    });
    return NextResponse.json({ ok: true, draft: serializeDraft(full), customer });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
