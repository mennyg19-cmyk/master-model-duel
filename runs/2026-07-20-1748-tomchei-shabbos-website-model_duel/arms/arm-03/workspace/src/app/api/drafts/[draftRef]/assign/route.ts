import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse } from "@/lib/api-error";
import { assertCanMutateDraft } from "@/lib/orders/draft-access";
import { assignDraftLine } from "@/lib/orders/drafts";

type Ctx = { params: Promise<{ draftRef: string }> };

const addressSchema = z.object({
  label: z.string().optional().nullable(),
  recipientName: z.string().min(1),
  line1: z.string().min(1),
  line2: z.string().optional().nullable(),
  city: z.string().min(1),
  state: z.string().min(2).max(2),
  postalCode: z.string().min(5),
  country: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
});

const schema = z.object({
  lineId: z.string().min(1),
  mode: z.enum(["on_order", "address_book", "new_recipient"]),
  savedAddressId: z.string().optional().nullable(),
  newRecipient: addressSchema.optional().nullable(),
  autoSaveNew: z.boolean().optional(),
});

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { draftRef } = await ctx.params;
    const { order, actor } = await assertCanMutateDraft(draftRef, request);
    const body = schema.parse(await request.json());
    const customerId =
      actor.kind === "customer"
        ? actor.customerId
        : actor.kind === "staff"
          ? order.customerId
          : order.customerId;

    const result = await assignDraftLine({
      orderId: order.id,
      customerId,
      lineId: body.lineId,
      mode: body.mode,
      savedAddressId: body.savedAddressId,
      newRecipient: body.newRecipient,
      autoSaveNew: body.autoSaveNew,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...result.value });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
