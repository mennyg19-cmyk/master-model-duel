import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { buyLabel, LabelPurchaseError } from "@/lib/shipping/labels";
import { ShippoNotConfiguredError } from "@/lib/shipping/shippo";

export const dynamic = "force-dynamic";

// R-055: buy the carrier label for a SHIPPED package. Validates the address
// (R-177), re-quotes live, charges the frozen checkout snapshot, books the
// UR-003 margin on success; R-175 failures land on the Shipment row, never
// on the paid order.
export async function POST(_request: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const { packageId } = await params;

  try {
    const shipment = await buyLabel({ packageId, ctx: gate.ctx });
    return NextResponse.json({
      ok: true,
      shipment: {
        id: shipment.id,
        status: shipment.status,
        carrier: shipment.carrier,
        serviceLevel: shipment.serviceLevel,
        trackingNumber: shipment.trackingNumber,
        labelUrl: shipment.labelUrl,
        chargedCents: shipment.chargedCents,
        costCents: shipment.costCents,
        marginCents: shipment.marginCents,
      },
    });
  } catch (error) {
    const mapped = mapDomainError(error, [
      [LabelPurchaseError, 502],
      [ShippoNotConfiguredError, 503],
    ]);
    if (mapped) return mapped;
    throw error;
  }
}
