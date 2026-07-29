import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { guardPublicCheckoutMutation } from "@/lib/public-guard";
import { checkoutAccess } from "@/lib/checkout/access";
import { payCheckout } from "@/lib/checkout/pay";
import { StripeNotConfiguredError } from "@/lib/payments/stripe";

export const dynamic = "force-dynamic";

const paySchema = z.object({ draftRef: z.string().min(1) });

// R-166/G-007: create the hosted Stripe Checkout session for a submitted
// draft. Without live keys the seam is explicit: 503 "not configured" — never
// a fake redirect, never a fake paid state.
export async function POST(request: Request) {
  const blocked = guardPublicCheckoutMutation(request);
  if (blocked) return blocked;

  const parsed = await parseBody(request, paySchema, "A draft reference is required");
  if (!parsed.ok) return parsed.response;

  const access = await checkoutAccess(parsed.data.draftRef);
  const origin = request.headers.get("origin") ?? new URL(request.url).origin;

  try {
    const result = await payCheckout(parsed.data.draftRef, access, origin);
    if (!result) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    return NextResponse.json({ ok: true, checkoutUrl: result.checkoutUrl });
  } catch (error) {
    const mapped = mapDomainError(error, [[StripeNotConfiguredError, 503]]);
    if (mapped) return mapped;
    throw error;
  }
}
