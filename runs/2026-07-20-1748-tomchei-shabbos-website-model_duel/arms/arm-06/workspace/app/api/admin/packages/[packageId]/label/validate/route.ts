import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { validatePackageAddress } from "@/lib/shipping/labels";
import { ShippoApiError, ShippoNotConfiguredError } from "@/lib/shipping/shippo";

export const dynamic = "force-dynamic";

// R-177 on demand: carrier address validation without buying anything.
export async function POST(_request: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const { packageId } = await params;

  try {
    const validation = await validatePackageAddress({ packageId, ctx: gate.ctx });
    return NextResponse.json({ ok: true, validation });
  } catch (error) {
    const mapped = mapDomainError(error, [
      [ShippoApiError, 502],
      [ShippoNotConfiguredError, 503],
    ]);
    if (mapped) return mapped;
    throw error;
  }
}
