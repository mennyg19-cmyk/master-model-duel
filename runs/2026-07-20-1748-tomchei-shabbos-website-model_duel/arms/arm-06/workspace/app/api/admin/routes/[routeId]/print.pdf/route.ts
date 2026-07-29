import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { renderRouteManifestPdf } from "@/lib/routes/print";

export const dynamic = "force-dynamic";

// R-077 route print + G-030 printed fallback: the seq-ordered manifest the
// driver can work from when the magic link is not an option.
export async function GET(_request: Request, { params }: { params: Promise<{ routeId: string }> }) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const { routeId } = await params;

  try {
    const pdf = await renderRouteManifestPdf(routeId);
    return new NextResponse(Buffer.from(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="route-${routeId}.pdf"` },
    });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
