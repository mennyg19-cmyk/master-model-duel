import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse } from "@/lib/api-error";
import { assertCanMutateDraft } from "@/lib/orders/draft-access";
import { addDraftLine } from "@/lib/orders/drafts";

type Ctx = { params: Promise<{ draftRef: string }> };

const schema = z.object({
  productId: z.string().min(1),
  productOptionId: z.string().optional().nullable(),
  quantity: z.number().int().min(1).default(1),
  addOnIds: z.array(z.string()).optional(),
});

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { draftRef } = await ctx.params;
    const { order } = await assertCanMutateDraft(draftRef, request);
    const body = schema.parse(await request.json());
    const result = await addDraftLine({
      orderId: order.id,
      productId: body.productId,
      productOptionId: body.productOptionId,
      quantity: body.quantity,
      addOnIds: body.addOnIds,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({ ok: true, draft: result.value.draft });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
