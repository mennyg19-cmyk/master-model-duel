import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { finalizeOrder } from "@/lib/domain/finalize";

/**
 * Staff finalize (R-044): flips DRAFT→FINALIZED, reserves stock, claims the
 * sequential number, and explodes lines into packages. The POS flow posts the
 * cash/check payment first, then finalizes through here.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("orders.manage");
  if ("response" in gate) return gate.response;

  const { id } = await params;
  const order = await db.order.findUnique({ where: { id } });
  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });

  try {
    // Audit commits atomically with the state change (same pattern as void/post).
    const finalized = await db.$transaction(async (tx) => {
      const result = await finalizeOrder(id, gate.staff.realUser.id, tx);
      await writeAudit(
        gate.staff,
        {
          action: "order.finalize",
          targetType: "Order",
          targetId: id,
          detail: { orderNumber: result.orderNumber },
        },
        tx
      );
      return result;
    });
    return Response.json({ ok: true, orderNumber: finalized.orderNumber });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Finalize failed" }, { status: 409 });
  }
}
