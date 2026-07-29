import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiCustomer } from "@/lib/customers/session";
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

// P10: the review plan as JSON (same data the review page renders
// server-side) so API clients can drive the confirm round-trip.
export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const gate = await requireApiCustomer();
  if (!gate.ok) return gate.response;
  const { orderId } = await params;

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { customerId: true } });
  if (!order || order.customerId !== gate.ctx.customer.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  try {
    const plan = await buildRepeatPlan(orderId);
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}

// P10 (UR-007/G-012): customer confirms the repeat review — replacements and
// recipients — and the confirmed plan becomes a fresh draft in the open
// season. Ownership: only the order's own customer may repeat it.
export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const gate = await requireApiCustomer();
  if (!gate.ok) return gate.response;
  const { orderId } = await params;

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { customerId: true } });
  if (!order || order.customerId !== gate.ctx.customer.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const parsed = await parseBody(request, confirmSchema, "Line and recipient decisions are required");
  if (!parsed.ok) return parsed.response;

  try {
    const { draft, summary } = await createDraftFromRepeat({
      sourceOrderId: orderId,
      lines: parsed.data.lines,
      recipients: parsed.data.recipients,
    });
    await recordAudit({
      actor: { id: gate.ctx.customer.id, email: gate.ctx.customer.email },
      action: "repeat_create",
      targetType: "Order",
      targetId: orderId,
      metadata: {
        draftRef: draft.draftRef,
        kept: summary.kept.length,
        swapped: summary.swapped.length,
        removed: summary.removed.length,
      },
    });
    return NextResponse.json({ ok: true, draftRef: draft.draftRef, summary });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
