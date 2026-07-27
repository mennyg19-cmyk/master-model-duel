import { requirePermissionApi } from "@/lib/auth/current-user";
import { ActionError } from "@/lib/packages/actions";
import { refreshShipmentTracking } from "@/lib/shipping/labels";
import { getOpenSeason } from "@/lib/season";

/** Pull the latest carrier tracking status onto the shipment (R-176). */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("fulfillment.manage");
  if ("response" in gate) return gate.response;
  const { id } = await context.params;

  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "No open season" }, { status: 409 });

  try {
    const shipment = await refreshShipmentTracking(season.id, id);
    return Response.json({ ok: true, trackingStatus: shipment.trackingStatus });
  } catch (error) {
    if (error instanceof ActionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
