import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { parseBody } from "@/lib/parse-body";
import { reassignStop } from "@/lib/routes/builder";

export const dynamic = "force-dynamic";

const reassignSchema = z.object({
  stopId: z.string().min(1),
  toRouteId: z.string().min(1),
});

// R-077: move a stop between PLANNED routes; both sides log a route event
// and the audit row carries the move. A started route's manifest is fixed.
export async function POST(request: Request, { params }: { params: Promise<{ routeId: string }> }) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const { routeId } = await params;
  const parsed = await parseBody(request, reassignSchema, "A stop id and a target route id are required");
  if (!parsed.ok) return parsed.response;

  try {
    await reassignStop({ routeId, ...parsed.data, ctx: gate.ctx });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
