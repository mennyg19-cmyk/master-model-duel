import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { refundStripePayment } from "@/lib/checkout";
import { authorize, hasSameOrigin } from "@/lib/route-auth";

type RouteContext = { params: Promise<{ orderId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authorization = await authorize(request, "orders.read");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const includeMargin = authorization.staffMember.role === "MANAGER";
  const { orderId } = await context.params;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: true,
      lines: { include: { addOns: true } },
      payments: true,
      packages: {
        include: {
          fulfillmentMethod: true,
          shipmentBoxes: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              carrier: true,
              service: true,
              labelUrl: true,
              trackingNumber: true,
              trackingStatus: true,
              labelVoidedAt: true,
              ...(includeMargin ? {
                chargedCents: true,
                labelCostCents: true,
                marginCents: true,
              } : {}),
            },
          },
        },
      },
    },
  });
  return order ? NextResponse.json({ order }) : NextResponse.json({ error: "Order not found." }, { status: 404 });
}

export async function POST(request: Request, context: RouteContext) {
  const authorization = await authorize(request, "orders.refund");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const { paymentId } = await request.json().catch(() => ({}));
  if (typeof paymentId !== "string") return NextResponse.json({ error: "Provide a payment to refund." }, { status: 400 });
  const { orderId } = await context.params;
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, orderId } });
  if (!payment) return NextResponse.json({ error: "Payment does not belong to this order." }, { status: 404 });
  try {
    await refundStripePayment(paymentId, authorization.staffMember.id);
    return NextResponse.json({ refunded: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Refund could not be completed." }, { status: 400 });
  }
}
