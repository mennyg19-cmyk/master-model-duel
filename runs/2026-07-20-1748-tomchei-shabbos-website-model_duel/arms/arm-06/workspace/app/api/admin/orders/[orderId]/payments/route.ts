import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { postPaymentTx } from "@/lib/payments/post";

export const dynamic = "force-dynamic";

// Offline methods only: card money posts exclusively through the Stripe
// webhook, so a staff screen can never fake a card payment (UR-011).
const postSchema = z.object({
  method: z.enum(["CASH", "CHECK", "COMP"]),
  amountCents: z.number().int().positive(),
});

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const gate = await requireApiPermission("payments.manage");
  if (!gate.ok) return gate.response;

  const { orderId } = await params;
  const parsed = await parseBody(request, postSchema, "A payment method and amount are required");
  if (!parsed.ok) return parsed.response;

  try {
    // The audit row commits inside the same transaction as the payment — a
    // crash between the two can never leave a posted payment with no trail.
    const payment = await prisma.$transaction(async (tx) => {
      const posted = await postPaymentTx(tx, {
        orderId,
        method: parsed.data.method,
        amountCents: parsed.data.amountCents,
        postedById: gate.ctx.staff.id,
      });
      await recordAudit(
        {
          ctx: gate.ctx,
          action: "payment_post",
          targetType: "Payment",
          targetId: posted.id,
          metadata: {
            orderId,
            method: posted.method,
            amountCents: posted.amountCents,
            channel: "pos",
          },
        },
        tx,
      );
      return posted;
    });
    return NextResponse.json({
      ok: true,
      payment: {
        id: payment.id,
        orderId: payment.orderId,
        method: payment.method,
        amountCents: payment.amountCents,
        status: payment.status,
      },
    });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
