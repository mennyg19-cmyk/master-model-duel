import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { voidPayment } from "@/lib/payments/post-payment";

/**
 * Voids a posted offline payment through the shared voidPayment helper (one
 * void implementation): row kept for the books, money stops counting, audited
 * atomically. Stripe payments are refunded, never voided.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const gate = await requirePermissionApi("payments.record");
  if ("response" in gate) return gate.response;

  const { id, paymentId } = await params;
  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.orderId !== id) {
    return Response.json({ error: "Payment not found on this order" }, { status: 404 });
  }

  const result = await voidPayment(paymentId, gate.staff);
  if (!result.ok) {
    return result.reason === "stripe_not_voidable"
      ? Response.json({ error: "Stripe payments are refunded, not voided" }, { status: 400 })
      : Response.json({ error: "Payment is already voided" }, { status: 409 });
  }

  return Response.json({ ok: true });
}
