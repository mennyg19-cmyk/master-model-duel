import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { loadRouteDetail } from "@/lib/routes/builder";

export const dynamic = "force-dynamic";

// R-077 route detail: stops in seq order, link existence/expiry (never the
// token), and the last 50 route events — the audit tap in readable form.
export async function GET(_request: Request, { params }: { params: Promise<{ routeId: string }> }) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const { routeId } = await params;

  try {
    const route = await loadRouteDetail(routeId);
    return NextResponse.json({ ok: true, route });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
