import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse } from "@/lib/api-error";
import { withPublicGuard } from "@/lib/http/public-guard";
import { loadDraftForAccess } from "@/lib/orders/draft-access";
import {
  buildMockCheckoutCompletedEvent,
  processStripeWebhook,
} from "@/lib/payments/webhook";
import { getStripeMode, signWebhookPayload } from "@/lib/stripe/client";

const schema = z.object({
  sessionId: z.string().min(1),
  orderId: z.string().min(1),
  draftRef: z.string().min(1),
  amountCents: z.number().int().positive(),
  eventId: z.string().optional(),
});

/** Mock Stripe mode only — simulates hosted Checkout redirect completing. */
export async function POST(request: Request) {
  if (getStripeMode() !== "mock") {
    return NextResponse.json({ ok: false, error: "Not available" }, { status: 404 });
  }

  try {
    const guarded = await withPublicGuard(request, schema, {
      rateKey: "checkout-mock-complete",
      limit: 20,
    });
    if (!guarded.ok) return guarded.response;

    const { order } = await loadDraftForAccess(guarded.data.draftRef, request);
    if (order.id !== guarded.data.orderId) {
      return NextResponse.json({ ok: false, error: "Draft not found" }, { status: 404 });
    }

    const event = buildMockCheckoutCompletedEvent({
      sessionId: guarded.data.sessionId,
      orderId: guarded.data.orderId,
      amountCents: guarded.data.amountCents,
      eventId: guarded.data.eventId,
    });
    const signature = signWebhookPayload(event.body);
    const result = await processStripeWebhook({
      rawBody: event.body,
      signature,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      type: result.value.type,
      replay: result.value.replay,
      eventId: event.eventId,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
