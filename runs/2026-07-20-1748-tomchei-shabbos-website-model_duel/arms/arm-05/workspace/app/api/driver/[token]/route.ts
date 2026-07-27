import { NextResponse } from "next/server";
import { z } from "zod";
import { deliverDriverStop, readDriverRoute, startDriverRoute } from "@/lib/delivery";

type RouteContext = { params: Promise<{ token: string }> };

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), pin: z.string().regex(/^\d{4}$/).optional() }),
  z.object({ action: z.literal("start"), pin: z.string().regex(/^\d{4}$/).optional() }),
  z.object({ action: z.literal("deliver"), stopId: z.string().cuid(), pin: z.string().regex(/^\d{4}$/).optional() }),
]);

export async function GET(request: Request, context: RouteContext) {
  const { token } = await context.params;
  try {
    return NextResponse.json(await readDriverRoute(token), {
      headers: { "Cache-Control": "no-store, no-cache" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Driver route could not be loaded." }, { status: 403 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid driver action." }, { status: 400 });
  const { token } = await context.params;
  try {
    if (parsed.data.action === "read") {
      return NextResponse.json(await readDriverRoute(token, parsed.data.pin), {
        headers: { "Cache-Control": "no-store, no-cache" },
      });
    }
    if (parsed.data.action === "start") return NextResponse.json({ route: await startDriverRoute(token, parsed.data.pin) });
    await deliverDriverStop(token, parsed.data.stopId, parsed.data.pin);
    return NextResponse.json({ delivered: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delivery could not be recorded.";
    return NextResponse.json({ error: message }, { status: message.includes("Too many") ? 429 : 403 });
  }
}
