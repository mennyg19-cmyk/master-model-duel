import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse } from "@/lib/api-error";
import { withPublicGuard } from "@/lib/http/public-guard";
import { assertCanMutateDraft, loadDraftForAccess } from "@/lib/orders/draft-access";
import {
  buildCheckoutSummary,
  createHostedCheckoutSession,
  prepareCheckout,
} from "@/lib/checkout/session";
import { AuthError } from "@/lib/auth";

const prepareSchema = z.object({
  draftRef: z.string().min(1),
  greetingDefault: z.string().max(500).optional(),
  donationCents: z.number().int().min(0).optional(),
  clientExpectedTotalCents: z.number().int().nullable().optional(),
  refreshPrices: z.boolean().optional(),
  recipients: z
    .array(
      z.object({
        lineIds: z.array(z.string()).min(1),
        fulfillmentMethodCode: z.string().min(1),
        greeting: z.string().max(500).nullable().optional(),
        purimDay: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

const startSchema = z.object({
  draftRef: z.string().min(1),
  clientExpectedTotalCents: z.number().int().nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const draftRef = url.searchParams.get("draft");
    if (!draftRef) {
      return NextResponse.json({ ok: false, error: "draft required" }, { status: 400 });
    }
    const { order } = await loadDraftForAccess(draftRef, request);
    const summary = await buildCheckoutSummary(order.id);
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") ?? "start";

    if (action === "prepare") {
      const guarded = await withPublicGuard(request, prepareSchema, {
        rateKey: "checkout-prepare",
        limit: 30,
      });
      if (!guarded.ok) return guarded.response;
      const { order } = await assertCanMutateDraft(guarded.data.draftRef, request);
      const result = await prepareCheckout({
        orderId: order.id,
        recipients: guarded.data.recipients,
        greetingDefault: guarded.data.greetingDefault,
        donationCents: guarded.data.donationCents,
        clientExpectedTotalCents: guarded.data.clientExpectedTotalCents,
        refreshPrices: guarded.data.refreshPrices,
      });
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
      }
      return NextResponse.json({
        ok: result.value.conflicts.length === 0,
        summary: result.value.summary,
        conflicts: result.value.conflicts,
      });
    }

    const guarded = await withPublicGuard(request, startSchema, {
      rateKey: "checkout-start",
      limit: 20,
    });
    if (!guarded.ok) return guarded.response;

    const { order } = await assertCanMutateDraft(guarded.data.draftRef, request);
    const result = await createHostedCheckoutSession({
      orderId: order.id,
      clientExpectedTotalCents: guarded.data.clientExpectedTotalCents,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    if (result.value.conflicts?.length) {
      return NextResponse.json({
        ok: false,
        conflicts: result.value.conflicts,
        error: "Checkout validation failed",
      }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      sessionId: result.value.sessionId,
      url: result.value.url,
      amountCents: result.value.amountCents,
    });
  } catch (error) {
    if (error instanceof AuthError) return apiErrorResponse(error);
    return apiErrorResponse(error);
  }
}
