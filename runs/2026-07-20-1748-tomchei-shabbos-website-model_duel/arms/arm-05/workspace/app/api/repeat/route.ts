import { NextResponse } from "next/server";
import { z } from "zod";
import { createRepeatDraft } from "@/lib/repeat-orders";
import { findCustomerForRequest } from "@/lib/order-builder";
import { hasSameOrigin } from "@/lib/route-auth";

const createSchema = z.object({
  sourceOrderId: z.string().cuid(),
  targetSeasonId: z.string().cuid(),
});

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const customer = await findCustomerForRequest(request);
  if (!customer) return NextResponse.json({ error: "Sign in to repeat a prior order." }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a prior order and open season." }, { status: 400 });
  try {
    const draft = await createRepeatDraft(parsed.data.sourceOrderId, parsed.data.targetSeasonId, customer.customerId);
    return NextResponse.json({ draftId: draft.id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to prepare the repeat order." }, { status: 400 });
  }
}
