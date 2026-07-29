import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { mapDomainError } from "@/lib/http-errors";
import { finalizePosOrder, SessionInFlightError } from "@/lib/checkout/pos";

export const dynamic = "force-dynamic";

// UR-011/G-028 POS: staff finalize a submitted draft at the counter. Stock
// commits here; payment posts separately with its own audit row.
export async function POST(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const gate = await requireApiPermission("payments.manage");
  if (!gate.ok) return gate.response;

  const { orderId } = await params;
  try {
    const order = await finalizePosOrder(orderId);
    await recordAudit({
      ctx: gate.ctx,
      action: "order_finalize",
      targetType: "Order",
      targetId: order.id,
      metadata: { orderNumber: order.orderNumber, wireFormat: order.wireFormat, channel: "pos" },
    });
    return NextResponse.json({
      ok: true,
      order: { id: order.id, orderNumber: order.orderNumber, wireFormat: order.wireFormat, totalCents: order.totalCents },
    });
  } catch (error) {
    const mapped = mapDomainError(error, [[SessionInFlightError, 409]]);
    if (mapped) return mapped;
    throw error;
  }
}
