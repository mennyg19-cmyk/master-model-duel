import { requirePermissionApi } from "@/lib/auth/current-user";
import { ActionError } from "@/lib/packages/actions";
import { markStopDelivered } from "@/lib/routes/service";
import { getOpenSeason } from "@/lib/season";

/** Printed-fallback path: staff mark a stop delivered from route detail. */
export async function POST(_request: Request, context: { params: Promise<{ id: string; stopId: string }> }) {
  const gate = await requirePermissionApi("fulfillment.manage");
  if ("response" in gate) return gate.response;
  const { id, stopId } = await context.params;

  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "No open season" }, { status: 409 });

  try {
    const outcome = await markStopDelivered(season.id, id, stopId, {
      kind: "staff",
      staffId: gate.staff.realUser.id,
      staffEmail: gate.staff.realUser.email,
    });
    return Response.json({ ok: true, routeCompleted: outcome.completed });
  } catch (error) {
    if (error instanceof ActionError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
