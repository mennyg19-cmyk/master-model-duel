import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { forceResolveStuckPurchase } from "@/lib/shipping/labels";

export const dynamic = "force-dynamic";

// Staff escape hatch for a stuck PURCHASING row: if the carrier confirmed the
// transaction it flips to PURCHASED (recovered), otherwise FAILED so the
// package can buy again. The cron sweep applies the same resolution on a TTL;
// this route is the on-demand version for support.
export async function POST(_request: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const { packageId } = await params;

  try {
    const shipment = await forceResolveStuckPurchase({ packageId, ctx: gate.ctx });
    return NextResponse.json({ ok: true, shipment: { id: shipment.id, status: shipment.status } });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
