import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, getAuthIdentity } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { db } from "@/lib/db";
import { resolveCustomerId } from "@/lib/orders/draft-access";
import { confirmRepeatOrder, previewRepeatOrder } from "@/lib/ops/repeat";

type Ctx = { params: Promise<{ id: string }> };

async function assertOwnsOrder(orderId: string) {
  const identity = await getAuthIdentity();
  if (!identity) throw new AuthError(401, "Sign in required");
  const customerId = await resolveCustomerId();
  if (!customerId) throw new AuthError(401, "Customer profile required");
  const order = await db.order.findFirst({
    where: { id: orderId, customerId },
  });
  if (!order) throw new AuthError(404, "Order not found");
  return { customerId, order };
}

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await assertOwnsOrder(id);
    const preview = await previewRepeatOrder({ sourceOrderId: id });
    if (!preview.ok) {
      return NextResponse.json({ ok: false, error: preview.publicMessage }, { status: 409 });
    }
    return NextResponse.json({ ok: true, preview: preview.value });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const confirmSchema = z.object({
  targetSeasonId: z.string().optional(),
  choices: z
    .array(
      z.object({
        sourceLineId: z.string().min(1),
        action: z.enum(["map", "remove"]),
        toProductId: z.string().nullable().optional(),
        keepRecipient: z.boolean().optional(),
        savedAddressId: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { customerId } = await assertOwnsOrder(id);
    const body = confirmSchema.parse(await request.json());
    const result = await confirmRepeatOrder({
      sourceOrderId: id,
      targetSeasonId: body.targetSeasonId,
      choices: body.choices,
      actorCustomerId: customerId,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...result.value });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
