import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_BULK_ORDERS, repeatOrders } from "@/lib/admin-operations";
import { AccessDeniedError, requirePermission } from "@/lib/auth";

const requestSchema = z.object({
  sources: z
    .array(z.object({ orderId: z.string().min(1), version: z.number().int().positive() }))
    .min(1)
    .max(MAX_BULK_ORDERS),
});

export async function POST(request: Request) {
  try {
    const session = await requirePermission("orders:manage");
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Choose 1-${MAX_BULK_ORDERS} versioned source orders.` },
        { status: 400 },
      );
    }
    return NextResponse.json(await repeatOrders(session.actor.id, parsed.data.sources));
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
