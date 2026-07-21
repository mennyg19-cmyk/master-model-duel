import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { ActionError } from "@/lib/packages/actions";
import { voidShipmentById } from "@/lib/shipping/labels";
import { getOpenSeason } from "@/lib/season";

/** Void an active label while the box hasn't shipped (S3 guard / P9 reroute hook). */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("fulfillment.manage");
  if ("response" in gate) return gate.response;
  const { id } = await context.params;

  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "No open season" }, { status: 409 });

  try {
    const shipment = await voidShipmentById(season.id, id, gate.staff.realUser.id);
    await writeAudit(gate.staff, {
      action: "shipping.label.void",
      targetType: "Package",
      targetId: shipment.packageId,
      detail: { shipmentId: shipment.id, carrier: shipment.carrier, costCents: shipment.costCents },
    });
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ActionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
