import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { voidPaymentTx } from "@/lib/payments/post";

export const dynamic = "force-dynamic";

const voidSchema = z.object({ reason: z.string().min(1).max(500) });

// UR-011/G-028: voiding keeps the row (audit trail) and flips it VOIDED; the
// cached payment status recomputes inside the engine transaction.
export async function POST(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const gate = await requireApiPermission("payments.manage");
  if (!gate.ok) return gate.response;

  const { paymentId } = await params;
  const parsed = await parseBody(request, voidSchema, "A void reason is required");
  if (!parsed.ok) return parsed.response;

  try {
    const payment = await prisma.$transaction(async (tx) => {
      const voided = await voidPaymentTx(tx, paymentId, parsed.data.reason);
      // Same transaction as the void: the durable regulatory record can never
      // be lost to a crash between commit and audit.
      await recordAudit(
        {
          ctx: gate.ctx,
          action: "payment_void",
          targetType: "Payment",
          targetId: voided.id,
          metadata: {
            orderId: voided.orderId,
            method: voided.method,
            amountCents: voided.amountCents,
            reason: parsed.data.reason,
          },
        },
        tx,
      );
      return voided;
    });
    return NextResponse.json({ ok: true, payment: { id: payment.id, status: payment.status } });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
