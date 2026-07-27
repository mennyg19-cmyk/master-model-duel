import { NextResponse } from "next/server";
import { voidOfflinePayment } from "@/lib/checkout";
import { authorize, hasSameOrigin } from "@/lib/route-auth";

type RouteContext = { params: Promise<{ paymentId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const authorization = await authorize(request, "orders.write");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const { paymentId } = await context.params;
    await voidOfflinePayment(paymentId, authorization.staffMember.id);
    return NextResponse.json({ voided: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment could not be voided." }, { status: 400 });
  }
}
