import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse } from "@/lib/api-error";
import { assertCanMutateDraft } from "@/lib/orders/draft-access";
import { removeDraftLine, updateDraftLineQty } from "@/lib/orders/drafts";

type Ctx = { params: Promise<{ draftRef: string; lineId: string }> };

const schema = z.object({
  quantity: z.number().int().min(1).optional(),
});

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { draftRef, lineId } = await ctx.params;
    const { order } = await assertCanMutateDraft(draftRef, request);
    const body = schema.parse(await request.json());
    if (body.quantity == null) {
      return NextResponse.json({ ok: false, error: "quantity required" }, { status: 400 });
    }
    const result = await updateDraftLineQty(order.id, lineId, body.quantity);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({ ok: true, draft: result.value.draft });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const { draftRef, lineId } = await ctx.params;
    const { order } = await assertCanMutateDraft(draftRef, request);
    const result = await removeDraftLine(order.id, lineId);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({ ok: true, draft: result.value.draft });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
