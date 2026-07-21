import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { getOpenSeason } from "@/lib/season";
import { loadRepeatableOrder, repeatOrderIntoPosDraft } from "@/lib/repeat";

/**
 * Staff single-order repeat (R-057): auto-map the order's lines into the
 * customer's POS draft — same product, replacement chain, else the
 * price-smart suggestion. The POS builder is where staff review the result;
 * lines with no available product at all are skipped and reported.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("orders.manage");
  if ("response" in gate) return gate.response;

  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "The store is closed — open a season first" }, { status: 409 });

  const { id } = await params;
  const order = await loadRepeatableOrder(id);
  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });
  if (order.status !== "FINALIZED") {
    return Response.json({ error: "Only finalized orders can be repeated" }, { status: 409 });
  }

  const outcome = await repeatOrderIntoPosDraft(order, season);
  await writeAudit(gate.staff, {
    action: "order.repeat.staff",
    targetType: "Order",
    targetId: order.id,
    detail: { customerId: order.customerId, ...outcome },
  });
  return Response.json({
    ok: true,
    customerId: order.customerId,
    ...outcome,
    posUrl: `/admin/pos?customerId=${encodeURIComponent(order.customerId)}`,
  });
}
