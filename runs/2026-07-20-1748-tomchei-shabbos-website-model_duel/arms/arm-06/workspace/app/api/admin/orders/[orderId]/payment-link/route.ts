import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { sendPaymentLinkEmail } from "@/lib/email/order-emails";

export const dynamic = "force-dynamic";

// R-087: staff-triggered payment-link email on an unpaid FINALIZED order. The
// email lands in the outbox (drained by the sweep); the link points at the
// customer's account order page, which is the pay entry the P5 checkout flow
// already provides.
export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const gate = await requireApiPermission("payments.manage");
  if (!gate.ok) return gate.response;

  const { orderId } = await params;
  const origin = new URL(request.url).origin;
  try {
    const result = await sendPaymentLinkEmail({ orderId, payBaseUrl: origin, ctx: gate.ctx });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
