import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { getPaymentGateway } from "@/lib/payments/stripe";
import { recordRefund } from "@/lib/payments/post-payment";

const refundSchema = z.object({
  // Omit for a full refund of the Stripe payment.
  amountCents: z.number().int().min(1).optional(),
  note: z.string().max(500).optional(),
});

/** Manager-gated Stripe refund; the refund row lands via the same idempotent path the webhook uses. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("payments.refund");
  if ("response" in gate) return gate.response;

  const { id } = await params;
  const parsed = refundSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const stripePayment = await db.payment.findFirst({
    where: { orderId: id, method: "STRIPE", state: "POSTED", amountCents: { gt: 0 }, stripePaymentIntentId: { not: null } },
    orderBy: { receivedAt: "desc" },
  });
  if (!stripePayment) {
    return Response.json({ error: "No refundable Stripe payment on this order" }, { status: 404 });
  }

  const alreadyRefunded = await db.payment.aggregate({
    where: { orderId: id, method: "STRIPE", state: "POSTED", amountCents: { lt: 0 } },
    _sum: { amountCents: true },
  });
  const refundable = stripePayment.amountCents + (alreadyRefunded._sum.amountCents ?? 0);
  const amountCents = parsed.data.amountCents ?? refundable;
  if (amountCents > refundable) {
    return Response.json(
      { error: `Only ${refundable} cents remain refundable on this payment` },
      { status: 409 }
    );
  }

  const gateway = getPaymentGateway();
  const refund = await gateway.createRefund(stripePayment.stripePaymentIntentId!, amountCents);
  await recordRefund({
    orderId: id,
    amountCents,
    stripeRefundId: refund.refundId,
    stripePaymentIntentId: stripePayment.stripePaymentIntentId!,
    note: parsed.data.note ?? "Staff refund",
  });
  await writeAudit(gate.staff, {
    action: "payment.refund",
    targetType: "Order",
    targetId: id,
    detail: { refundId: refund.refundId, amountCents },
  });

  return Response.json({ ok: true, refundId: refund.refundId, amountCents });
}
