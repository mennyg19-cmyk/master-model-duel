import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { parseBody } from "@/lib/parse-body";
import { buildRoute, listRoutes } from "@/lib/routes/builder";
import { getOpenSeason } from "@/lib/seasons/queries";

export const dynamic = "force-dynamic";

const buildSchema = z.object({
  deliveryDay: z.string().min(1),
  name: z.string().min(1).optional(),
});

// R-074/R-075: route list + the one-tap builder. Build geocodes through the
// P4 cache and orders stops (Mapbox when MAPBOX_ACCESS_TOKEN is set,
// nearest-neighbor otherwise) — the response says which optimizer ran.
export async function GET() {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const season = await getOpenSeason();
  if (!season) return NextResponse.json({ error: "No open season" }, { status: 422 });
  const routes = await listRoutes(season.id);
  return NextResponse.json({ ok: true, routes });
}

export async function POST(request: Request) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const parsed = await parseBody(request, buildSchema, "A delivery day is required");
  if (!parsed.ok) return parsed.response;

  try {
    const built = await buildRoute({ ...parsed.data, ctx: gate.ctx });
    return NextResponse.json({ ok: true, ...built });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
