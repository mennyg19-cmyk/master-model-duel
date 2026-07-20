import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { recalcPaymentStatus } from "@/lib/domain/payment-status";

/**
 * Voids a posted offline payment (UR-011, G-028): the row stays for the books,
 * its money stops counting, and the void is audited. Stripe payments are not
 * voidable — money already moved; use the refund endpoint instead.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const gate = await requirePermissionApi("payments.record");
  if ("response" in gate) return gate.response;

  const { id, paymentId } = await params;
  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.orderId !== id) {
    return Response.json({ error: "Payment not found on this order" }, { status: 404 });
  }
  if (payment.method === "STRIPE") {
    return Response.json({ error: "Stripe payments are refunded, not voided" }, { status: 400 });
  }
  if (payment.state === "VOIDED") {
    return Response.json({ error: "Payment is already voided" }, { status: 409 });
  }

  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: paymentId },
      data: { state: "VOIDED", voidedAt: new Date(), voidedByStaffId: gate.staff.realUser.id },
    });
    await recalcPaymentStatus(tx, id);
    await writeAudit(
      gate.staff,
      {
        action: "payment.void",
        targetType: "Order",
        targetId: id,
        detail: { paymentId, method: payment.method, amountCents: payment.amountCents },
      },
      tx
    );
  });

  return Response.json({ ok: true });
}
