import { z } from "zod";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { ActionError } from "@/lib/packages/actions";
import { confirmReroute } from "@/lib/routes/service";
import { getOpenSeason } from "@/lib/season";

const schema = z.object({ packageId: z.string().min(1) });

/**
 * Manager-confirmed reroute (G-023): pull a nearby unshipped shipping package
 * onto this route — voids its label, switches the method, appends the stop.
 * This endpoint IS the explicit confirm; suggestions alone never mutate.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("fulfillment.manage");
  if ("response" in gate) return gate.response;
  const { id } = await context.params;

  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "No open season" }, { status: 409 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pick a package to reroute" }, { status: 400 });

  try {
    const stop = await confirmReroute(season.id, id, parsed.data.packageId, {
      id: gate.staff.realUser.id,
      email: gate.staff.realUser.email,
    });
    return Response.json({ ok: true, stopId: stop.id, position: stop.position });
  } catch (error) {
    if (error instanceof ActionError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
