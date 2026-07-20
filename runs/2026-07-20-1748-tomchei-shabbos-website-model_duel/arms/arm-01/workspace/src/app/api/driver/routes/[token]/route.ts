import { NextResponse } from "next/server";
import { z } from "zod";
import {
  accessDriverRoute,
  markStopDelivered,
  startDeliveryRoute,
} from "@/domain/delivery";
import { db } from "@/lib/db";

const driverActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), pin: z.string().regex(/^\d{4}$/) }),
  z.object({ action: z.literal("start"), pin: z.string().regex(/^\d{4}$/) }),
  z.object({
    action: z.literal("deliver"),
    pin: z.string().regex(/^\d{4}$/),
    stopId: z.string().min(1),
  }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const parsed = driverActionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Driver action details are invalid." }, { status: 400 });
    }
    const { token } = await params;
    const input = parsed.data;
    if (input.action === "start") {
      await startDeliveryRoute(db, token, input.pin);
    } else if (input.action === "deliver") {
      const delivered = await markStopDelivered(db, token, input.stopId, input.pin);
      if (delivered.completed) {
        return NextResponse.json({ completed: true });
      }
      return NextResponse.json(await accessDriverRoute(db, token, input.pin));
    }
    return NextResponse.json(await accessDriverRoute(db, token, input.pin));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Driver action failed." },
      { status: 401 },
    );
  }
}
