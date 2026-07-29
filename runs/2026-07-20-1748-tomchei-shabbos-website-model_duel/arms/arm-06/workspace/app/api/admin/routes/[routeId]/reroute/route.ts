import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { parseBody } from "@/lib/parse-body";
import { nearbyShippedSuggestions } from "@/lib/routes/builder";
import { confirmRouteReroute } from "@/lib/routes/reroute";

export const dynamic = "force-dynamic";

const rerouteSchema = z.object({
  packageId: z.string().min(1),
  confirm: z.literal(true),
});

// G-023/G-027: GET lists the nearby/same-street SHIPPED candidates; POST
// pulls one onto the route — always behind the manager's explicit confirm.
// The printed-not-shipped label voids through the P8 path before the flip.
export async function GET(_request: Request, { params }: { params: Promise<{ routeId: string }> }) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const { routeId } = await params;

  try {
    const suggestions = await nearbyShippedSuggestions(routeId);
    return NextResponse.json({ ok: true, suggestions });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ routeId: string }> }) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const { routeId } = await params;
  const parsed = await parseBody(request, rerouteSchema, "A package id and confirm: true are required (G-027)");
  if (!parsed.ok) return parsed.response;

  try {
    const result = await confirmRouteReroute({ routeId, ...parsed.data, ctx: gate.ctx });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
