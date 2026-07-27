import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { discardOrder } from "@/lib/domain/finalize";

/** Staff discard (R-045): DRAFT→DISCARDED only — the transition table refuses anything else. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("orders.manage");
  if ("response" in gate) return gate.response;

  const { id } = await params;
  const order = await db.order.findUnique({ where: { id } });
  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });

  try {
    // Audit commits atomically with the state change (same pattern as void/post).
    await db.$transaction(async (tx) => {
      await discardOrder(id, tx);
      await writeAudit(gate.staff, { action: "order.discard", targetType: "Order", targetId: id }, tx);
    });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Discard failed" }, { status: 409 });
  }
}
