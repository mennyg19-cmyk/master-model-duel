import { NextResponse } from "next/server";
import { z } from "zod";
import {
  MAX_REPEAT_BATCH,
  repeatOrdersInBulk,
  reviewOrdersInBulk,
} from "@/domain/repeat-orders";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

const sourceSchema = z.object({
  orderId: z.string().min(1),
  version: z.number().int().positive(),
});
const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("review"),
    sources: z.array(sourceSchema).min(1).max(MAX_REPEAT_BATCH),
  }),
  z.object({
    action: z.literal("create"),
    sources: z
      .array(
        sourceSchema.extend({
          decisions: z.array(
            z.object({
              sourceLineId: z.string().min(1),
              productId: z.string().min(1).nullable(),
              recipientAddressId: z.string().min(1),
            }),
          ).min(1),
        }),
      )
      .min(1)
      .max(MAX_REPEAT_BATCH),
  }),
]);

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
    if (parsed.data.action === "review") {
      return NextResponse.json(await reviewOrdersInBulk(db, parsed.data.sources));
    }
    return NextResponse.json(await repeatOrdersInBulk(
      db,
      session.actor.id,
      parsed.data.sources,
    ));
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
