import { NextResponse } from "next/server";
import { z } from "zod";
import { mapDomainError } from "@/lib/http-errors";
import { parseBody } from "@/lib/parse-body";
import { markStopDelivered } from "@/lib/routes/lifecycle";
import { requireActiveLink } from "../guard";

export const dynamic = "force-dynamic";

const deliverSchema = z.object({ stopId: z.string().min(1) });

// G-025/G-030: the Delivered tap via magic link. Atomic claim on
// deliveredAt IS NULL (double-tap safe), audits with the link id, advances
// the package to its terminal stage, completes the route on the last stop —
// which kills this link for any further use.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = await parseBody(request, deliverSchema, "A stop id is required");
  if (!parsed.ok) return parsed.response;

  const guard = await requireActiveLink(token);
  if ("response" in guard) return guard.response;

  try {
    const result = await markStopDelivered({
      routeId: guard.link.route.id,
      stopId: parsed.data.stopId,
      via: { linkId: guard.link.id },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
