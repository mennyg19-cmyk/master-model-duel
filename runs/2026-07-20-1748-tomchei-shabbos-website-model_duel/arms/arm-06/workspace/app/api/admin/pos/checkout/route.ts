import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { checkoutSubmitSchema } from "@/lib/checkout/fulfillment";
import { checkoutPosOrder } from "@/lib/payments/pos";
import { SessionInFlightError } from "@/lib/checkout/pos";
import { CheckoutConflictError } from "@/lib/checkout/validate";

export const dynamic = "force-dynamic";

// R-061: counter checkout — cash/check (comp via API) with the staff audit
// row. One call = submit + finalize + post payment; no public POS payments
// ever touch Stripe (UR-011).
const posCheckoutSchema = checkoutSubmitSchema.extend({
  amountCents: z.number().int().positive().optional(),
});

export async function POST(request: Request) {
  const gate = await requireApiPermission("payments.manage");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, posCheckoutSchema, "Checkout body is invalid");
  if (!parsed.ok) return parsed.response;

  if (parsed.data.method === "card") {
    return NextResponse.json(
      { error: "Card payment is customer-facing only — use cash or check at the counter" },
      { status: 422 },
    );
  }

  try {
    const outcome = await checkoutPosOrder({
      checkout: parsed.data,
      amountCents: parsed.data.amountCents,
      ctx: gate.ctx,
    });
    return NextResponse.json({
      ok: true,
      orderId: outcome.orderId,
      orderNumber: outcome.orderNumber,
      wireFormat: outcome.wireFormat,
      totalCents: outcome.totalCents,
      payment: outcome.payment,
    });
  } catch (error) {
    if (error instanceof CheckoutConflictError) {
      return NextResponse.json({ error: error.message, conflict: error.report }, { status: 409 });
    }
    if (error instanceof SessionInFlightError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
