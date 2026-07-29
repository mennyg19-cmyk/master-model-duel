import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { guardPublicCheckoutMutation } from "@/lib/public-guard";
import { checkoutAccess } from "@/lib/checkout/access";
import { checkoutSubmitSchema } from "@/lib/checkout/fulfillment";
import { OfflinePaymentForbiddenError, submitCheckout } from "@/lib/checkout/submit";
import { CheckoutConflictError } from "@/lib/checkout/validate";

export const dynamic = "force-dynamic";

// R-034/R-037, UR-009/UR-013: validate + freeze fulfillment choices, greeting,
// and fee snapshots; reserve stock. Public guards (R-122): same-origin, IP
// rate limit, zod. Ownership (R-121): session or guest cookie; a miss is 404.
export async function POST(request: Request) {
  const blocked = guardPublicCheckoutMutation(request);
  if (blocked) return blocked;

  const parsed = await parseBody(request, checkoutSubmitSchema, "A draft reference and checkout details are required");
  if (!parsed.ok) return parsed.response;

  const access = await checkoutAccess(parsed.data.draftRef);

  try {
    const summary = await submitCheckout(parsed.data, access);
    if (!summary) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    if (error instanceof CheckoutConflictError) {
      return NextResponse.json({ error: error.message, conflict: error.report }, { status: 409 });
    }
    const mapped = mapDomainError(error, [[OfflinePaymentForbiddenError, 403]]);
    if (mapped) return mapped;
    throw error;
  }
}
