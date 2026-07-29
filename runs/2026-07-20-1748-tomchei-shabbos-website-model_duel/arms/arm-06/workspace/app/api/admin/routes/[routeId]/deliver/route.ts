import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { parseBody } from "@/lib/parse-body";
import { markStopDelivered } from "@/lib/routes/lifecycle";

export const dynamic = "force-dynamic";

const deliverSchema = z.object({ stopId: z.string().min(1) });

// G-030 printed fallback: the driver worked the run from the paper manifest
// (no phone, dead battery), so staff stamp the stop delivered from the office.
// Same atomic claim, same audit tap — via staff id instead of the link id.
export async function POST(request: Request, { params }: { params: Promise<{ routeId: string }> }) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const { routeId } = await params;
  const parsed = await parseBody(request, deliverSchema, "A stop id is required");
  if (!parsed.ok) return parsed.response;

  try {
    const result = await markStopDelivered({ routeId, stopId: parsed.data.stopId, via: { staffId: gate.ctx.staff.id } });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
