import { NextResponse } from "next/server";
import { z } from "zod";
import { createPosOrder } from "@/lib/checkout";
import { authorize, hasSameOrigin } from "@/lib/route-auth";

type RouteContext = { params: Promise<{ orderId: string }> };
const paymentSchema = z.object({
  method: z.enum(["CASH", "CHECK"]),
  checkout: z.unknown(),
});

export async function POST(request: Request, context: RouteContext) {
  const authorization = await authorize(request, "orders.write");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = paymentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a cash or check method and valid checkout details." }, { status: 400 });
  try {
    const { orderId } = await context.params;
    const payment = await createPosOrder(orderId, parsed.data.checkout, parsed.data.method, authorization.staffMember.id, request.url);
    return NextResponse.json({ payment });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment could not be posted." }, { status: 400 });
  }
}
