import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { renderRouteCardsPdf } from "@/lib/routes/print";

export const dynamic = "force-dynamic";

// R-076/UR-013: per-route greeting cards — one 6x4 card-stock page per stop
// carrying a greeting, rendered on demand from the route's stops.
export async function GET(_request: Request, { params }: { params: Promise<{ routeId: string }> }) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const { routeId } = await params;

  try {
    const pdf = await renderRouteCardsPdf(routeId);
    return new NextResponse(Buffer.from(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="route-${routeId}-cards.pdf"` },
    });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
