import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { refreshTracking } from "@/lib/shipping/labels";
import { ShippoApiError, ShippoNotConfiguredError } from "@/lib/shipping/shippo";

export const dynamic = "force-dynamic";

// R-055 tracking: pull the carrier's latest status onto the Shipment row.
export async function POST(_request: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const { packageId } = await params;

  try {
    const shipment = await refreshTracking({ packageId, ctx: gate.ctx });
    return NextResponse.json({
      ok: true,
      shipment: {
        id: shipment.id,
        trackingNumber: shipment.trackingNumber,
        trackingStatus: shipment.trackingStatus,
        trackingStatusAt: shipment.trackingStatusAt,
      },
    });
  } catch (error) {
    const mapped = mapDomainError(error, [
      [ShippoApiError, 502],
      [ShippoNotConfiguredError, 503],
    ]);
    if (mapped) return mapped;
    throw error;
  }
}
