import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { postPayment } from "@/lib/payments/post-payment";

const postSchema = z.object({
  // Server-enforced offline-payment policy (R-127, UR-011, G-028): cash/check
  // (and comp) exist ONLY behind this staff gate — no public route accepts them.
  method: z.enum(["CASH", "CHECK", "COMP"]),
  amountCents: z.number().int().min(1).max(10_000_000),
  note: z.string().max(500).optional(),
});

/** Staff POS payment posting, audited (UR-011, G-028). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("payments.record");
  if ("response" in gate) return gate.response;

  const { id } = await params;
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const order = await db.order.findUnique({ where: { id } });
  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });
  if (order.status === "DISCARDED") {
    return Response.json({ error: "Cannot take payment on a discarded order" }, { status: 409 });
  }

  const payment = await db.$transaction(async (tx) => {
    const created = await postPayment({
      orderId: id,
      method: parsed.data.method,
      amountCents: parsed.data.amountCents,
      note: parsed.data.note,
      tx,
    });
    await writeAudit(
      gate.staff,
      {
        action: "payment.post",
        targetType: "Order",
        targetId: id,
        detail: { paymentId: created.id, method: parsed.data.method, amountCents: parsed.data.amountCents },
      },
      tx
    );
    return created;
  });

  return Response.json({ ok: true, paymentId: payment.id });
}
