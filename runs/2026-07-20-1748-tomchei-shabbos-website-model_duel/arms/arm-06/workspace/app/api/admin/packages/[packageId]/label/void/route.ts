import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { LabelVoidError, voidLabel } from "@/lib/shipping/labels";
import { ShippoNotConfiguredError } from "@/lib/shipping/shippo";

export const dynamic = "force-dynamic";

const voidSchema = z.object({ reason: z.string().max(500).optional() });

// R-176: void a purchased-but-unshipped label (address fix, re-rate, UR-004
// reroute hook). The void settles carrier-side; the Shipment row flips to
// VOIDED so the package can buy again.
export async function POST(request: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const { packageId } = await params;

  const parsed = await parseBody(request, voidSchema, "Invalid void request");
  if (!parsed.ok) return parsed.response;

  try {
    const shipment = await voidLabel({ packageId, ctx: gate.ctx, reason: parsed.data.reason });
    return NextResponse.json({ ok: true, shipment: { id: shipment.id, status: shipment.status, voidedAt: shipment.voidedAt } });
  } catch (error) {
    const mapped = mapDomainError(error, [
      [LabelVoidError, 502],
      [ShippoNotConfiguredError, 503],
    ]);
    if (mapped) return mapped;
    throw error;
  }
}
