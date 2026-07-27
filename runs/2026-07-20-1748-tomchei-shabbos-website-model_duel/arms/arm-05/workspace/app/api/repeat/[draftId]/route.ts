import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmRepeatDraft, readRepeatDraft } from "@/lib/repeat-orders";
import { findCustomerForRequest } from "@/lib/order-builder";
import { hasSameOrigin } from "@/lib/route-auth";

const confirmSchema = z.object({
  lines: z.array(z.object({
    sourceLineId: z.string().cuid(),
    productId: z.string().cuid().optional(),
    addressId: z.string().cuid().optional(),
    greeting: z.string().max(500),
  })).min(1).max(100),
});

type RouteContext = { params: Promise<{ draftId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const customer = await findCustomerForRequest(request);
  if (!customer) return NextResponse.json({ error: "Sign in to review a repeat order." }, { status: 401 });
  const { draftId } = await context.params;
  const review = await readRepeatDraft(draftId, customer.customerId);
  if (!review) return NextResponse.json({ error: "Repeat draft not found." }, { status: 404 });
  return NextResponse.json({
    draft: { id: review.draft.id, draftReference: review.draft.draftReference, season: review.draft.season },
    lines: review.repeat.lines,
    addresses: review.draft.customer?.addresses ?? [],
  });
}

export async function PUT(request: Request, context: RouteContext) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const customer = await findCustomerForRequest(request);
  if (!customer) return NextResponse.json({ error: "Sign in to confirm a repeat order." }, { status: 401 });
  const parsed = confirmSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Review every item, recipient, and greeting before continuing." }, { status: 400 });
  try {
    const { draftId } = await context.params;
    await confirmRepeatDraft(draftId, parsed.data.lines, customer.customerId);
    return NextResponse.json({ draftId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to confirm the repeat order." }, { status: 400 });
  }
}
