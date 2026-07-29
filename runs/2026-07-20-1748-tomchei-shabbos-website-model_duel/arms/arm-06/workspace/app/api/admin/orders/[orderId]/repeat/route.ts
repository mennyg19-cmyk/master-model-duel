import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { recordAudit } from "@/lib/audit";
import { createDraftFromRepeat } from "@/lib/repeat/create";
import { buildRepeatPlan } from "@/lib/repeat/plan";

export const dynamic = "force-dynamic";

const confirmSchema = z.object({
  lines: z
    .array(
      z.object({
        sourceLineId: z.string().min(1),
        action: z.enum(["keep", "remove", "swap"]),
        targetProductId: z.string().min(1).optional(),
        qty: z.number().int().positive().optional(),
      }),
    )
    .max(200),
  recipients: z
    .array(
      z.object({
        sourceRecipientId: z.string().min(1),
        action: z.enum(["keep", "remove"]),
        greeting: z.string().max(500).optional(),
      }),
    )
    .max(100),
});

// P10: staff-side plan JSON — same buildRepeatPlan the staff review page
// renders, for API-driven confirm round-trips.
export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const gate = await requireApiPermission("payments.manage");
  if (!gate.ok) return gate.response;
  const { orderId } = await params;

  try {
    const plan = await buildRepeatPlan(orderId);
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}

// P10 (R-057): staff repeat with review — same confirm contract as the
// customer flow, gated on payments.manage like the P6 one-click bulk repeat.
export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const gate = await requireApiPermission("payments.manage");
  if (!gate.ok) return gate.response;
  const { orderId } = await params;

  const parsed = await parseBody(request, confirmSchema, "Line and recipient decisions are required");
  if (!parsed.ok) return parsed.response;

  try {
    const { draft, summary } = await createDraftFromRepeat({
      sourceOrderId: orderId,
      lines: parsed.data.lines,
      recipients: parsed.data.recipients,
    });
    await recordAudit({
      ctx: gate.ctx,
      action: "repeat_create",
      targetType: "Order",
      targetId: orderId,
      metadata: {
        draftRef: draft.draftRef,
        kept: summary.kept.length,
        swapped: summary.swapped.length,
        removed: summary.removed.length,
        staff: true,
      },
    });
    return NextResponse.json({ ok: true, draftRef: draft.draftRef, summary });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
