import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { ActionError } from "@/lib/packages/actions";
import { buyLabelForPackage } from "@/lib/shipping/labels";
import { getOpenSeason } from "@/lib/season";

/** Buy a carrier label for a shipping package (R-055, margin engine UR-003). */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("fulfillment.manage");
  if ("response" in gate) return gate.response;
  const { id } = await context.params;

  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "No open season" }, { status: 409 });

  try {
    const shipment = await buyLabelForPackage(season.id, id, gate.staff.realUser.id);
    await writeAudit(gate.staff, {
      action: "shipping.label.buy",
      targetType: "Package",
      targetId: id,
      detail: {
        shipmentId: shipment.id,
        carrier: shipment.carrier,
        costCents: shipment.costCents,
        chargedCents: shipment.chargedCents,
        marginCents: shipment.marginCents,
      },
    });
    return Response.json({
      ok: true,
      shipmentId: shipment.id,
      carrier: shipment.carrier,
      trackingNumber: shipment.trackingNumber,
    });
  } catch (error) {
    if (error instanceof ActionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
