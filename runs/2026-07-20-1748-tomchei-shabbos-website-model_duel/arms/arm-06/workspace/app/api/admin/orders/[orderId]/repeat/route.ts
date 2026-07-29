import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { recordAudit } from "@/lib/audit";
import { autoConfirmPlan, createDraftFromRepeat } from "@/lib/repeat/create";
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

// P10 (R-057): staff repeat — two shapes, one route. A body with line and
// recipient decisions is the review confirm (same contract as the customer
// flow); an empty body is the one-click repeat, which auto-confirms the plan
// server-side. Both work cross-season (no open-season scope, unlike the P6
// bulk list action) and both are gated on payments.manage.
export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const gate = await requireApiPermission("payments.manage");
  if (!gate.ok) return gate.response;
  const { orderId } = await params;

  const raw = await request.json().catch(() => null);
  const oneClick = raw === null || (typeof raw === "object" && !Array.isArray((raw as { lines?: unknown }).lines));

  try {
    if (oneClick) {
      const plan = await buildRepeatPlan(orderId);
      const { draft, summary } = await createDraftFromRepeat(autoConfirmPlan(plan), plan);
      await recordAudit({
        ctx: gate.ctx,
        action: "repeat_create",
        targetType: "Order",
        targetId: orderId,
        metadata: {
          draftRef: draft.draftRef,
          kept: summary.kept.length,
          swapped: 0,
          removed: summary.removed.length,
          staff: true,
          oneClick: true,
        },
      });
      return NextResponse.json({ ok: true, draftRef: draft.draftRef, summary });
    }

    const parsed = confirmSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Line and recipient decisions are required" }, { status: 400 });
    }
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
