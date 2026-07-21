import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { getPaymentGateway } from "@/lib/payments/stripe";
import { beginStaffRefund, resolveStaffRefund, cancelStaffRefund } from "@/lib/payments/post-payment";

const refundSchema = z.object({
  // Omit for a full refund of the Stripe payment.
  amountCents: z.number().int().min(1).optional(),
  note: z.string().max(500).optional(),
});

/**
 * Manager-gated Stripe refund, DB-first (money-loss guard): the negative
 * payment row (plus audit) commits BEFORE Stripe is called, and the Stripe
 * call carries a stable idempotency key. Concurrent retries collide on the
 * unique placeholder refund id, so the same logical refund can never move
 * money twice. Refundable math is scoped to the chosen payment intent.
 */
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
  const paymentIntentId = stripePayment.stripePaymentIntentId!;

  const alreadyRefunded = await db.payment.aggregate({
    where: { stripePaymentIntentId: paymentIntentId, state: "POSTED", amountCents: { lt: 0 } },
    _sum: { amountCents: true },
  });
  const refundedCents = alreadyRefunded._sum.amountCents ?? 0;
  const refundable = stripePayment.amountCents + refundedCents;
  const amountCents = parsed.data.amountCents ?? refundable;
  if (refundable <= 0 || amountCents > refundable) {
    return Response.json(
      { error: `Only ${Math.max(0, refundable)} cents remain refundable on this payment` },
      { status: 409 }
    );
  }

  // Stable across retries of the same logical refund (same intent, amount, and
  // prior refund state); distinct once that refund lands and shrinks refundable.
  const idempotencyKey = createHash("sha256")
    .update(`refund:${paymentIntentId}:${amountCents}:${refundedCents}`)
    .digest("hex");

  const started = await beginStaffRefund({
    orderId: id,
    stripePaymentIntentId: paymentIntentId,
    chargeAmountCents: stripePayment.amountCents,
    amountCents,
    idempotencyKey,
    note: parsed.data.note ?? "Staff refund",
    staff: gate.staff,
  });
  if (!started.ok) return Response.json({ error: started.error }, { status: 409 });

  const gateway = getPaymentGateway();
  try {
    const refund = await gateway.createRefund(paymentIntentId, amountCents, idempotencyKey);
    await resolveStaffRefund(started.paymentId, refund.refundId);
    return Response.json({ ok: true, refundId: refund.refundId, amountCents });
  } catch (error) {
    // No money moved — roll the DB row back so refundable is restored.
    await cancelStaffRefund(started.paymentId);
    const message = error instanceof Error ? error.message : "Stripe refund failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
