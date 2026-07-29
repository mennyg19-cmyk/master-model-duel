import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { refundStripePayment } from "@/lib/payments/refund";

export const dynamic = "force-dynamic";

const refundSchema = z.object({ reason: z.string().trim().max(500).optional() });

// R-054: staff refund of a posted card payment. Idempotent at Stripe
// (refund-<paymentIntent>). On a keyless host the refund refuses 422 with
// operator instructions — the local record only ever voids on Stripe evidence
// (this route's refund, or the charge.refunded webhook), never on faith.
export async function POST(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const gate = await requireApiPermission("payments.manage");
  if (!gate.ok) return gate.response;

  const { paymentId } = await params;
  const parsed = await parseBody(request, refundSchema, "Refund body is invalid");
  if (!parsed.ok) return parsed.response;

  try {
    const outcome = await refundStripePayment({
      paymentId,
      reason: parsed.data.reason,
      actor: { id: gate.ctx.staff.id, email: gate.ctx.staff.email },
    });
    return NextResponse.json({
      ok: true,
      payment: { id: outcome.payment.id, status: outcome.payment.status, refundRef: outcome.payment.refundRef },
      note: "Stripe refund issued",
    });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
