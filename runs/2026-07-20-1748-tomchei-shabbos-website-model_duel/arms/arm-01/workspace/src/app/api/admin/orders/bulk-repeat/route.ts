import { NextResponse } from "next/server";
import { z } from "zod";
import {
  MAX_REPEAT_BATCH,
  repeatOrdersInBulk,
} from "@/domain/repeat-orders";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

const requestSchema = z.object({
  sources: z
    .array(z.object({ orderId: z.string().min(1), version: z.number().int().positive() }))
    .min(1)
    .max(MAX_REPEAT_BATCH),
});

export async function POST(request: Request) {
  try {
    const session = await requirePermission("orders:manage");
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Choose 1-${MAX_REPEAT_BATCH} versioned source orders.` },
        { status: 400 },
      );
    }
    return NextResponse.json(
      await repeatOrdersInBulk(db, session.actor.id, parsed.data.sources),
    );
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
