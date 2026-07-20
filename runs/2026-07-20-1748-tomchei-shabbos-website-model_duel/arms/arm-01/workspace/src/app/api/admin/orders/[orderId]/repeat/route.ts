import { NextResponse } from "next/server";
import { z } from "zod";
import { createRepeatDraft } from "@/domain/repeat-orders";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

const repeatSchema = z.object({
  sourceVersion: z.number().int().positive(),
  decisions: z.array(
    z.object({
      sourceLineId: z.string().min(1),
      productId: z.string().min(1).nullable(),
      recipientAddressId: z.string().min(1),
    }),
  ),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  try {
    const session = await requirePermission("orders:manage");
    const { orderId } = await context.params;
    const parsed = repeatSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Confirm every replacement and recipient." },
        { status: 400 },
      );
    }
    const draft = await createRepeatDraft(db, {
      sourceOrderId: orderId,
      sourceVersion: parsed.data.sourceVersion,
      decisions: parsed.data.decisions,
      actorStaffId: session.actor.id,
    });
    return NextResponse.json({ draftId: draft.id }, { status: 201 });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Order could not be repeated." },
      { status: 400 },
    );
  }
}
