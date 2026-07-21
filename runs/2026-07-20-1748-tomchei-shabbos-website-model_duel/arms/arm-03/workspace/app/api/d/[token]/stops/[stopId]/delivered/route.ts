import { ActionError } from "@/lib/packages/actions";
import { resolveDriverAccess } from "@/lib/routes/driver-access";
import { markStopDelivered } from "@/lib/routes/service";

/**
 * The driver's Delivered tap (UR-015). Scoped by construction: the stop must
 * belong to the link's own route; every tap is audited with the link id.
 */
export async function POST(_request: Request, context: { params: Promise<{ token: string; stopId: string }> }) {
  const { token, stopId } = await context.params;
  const access = await resolveDriverAccess(token);
  if (!access.ok) {
    const status = access.reason === "pin_required" ? 401 : 404;
    return Response.json({ error: "This link cannot mark deliveries" }, { status });
  }

  try {
    const outcome = await markStopDelivered(access.route.seasonId, access.route.id, stopId, {
      kind: "link",
      linkId: access.linkId,
    });
    return Response.json({ ok: true, routeCompleted: outcome.completed });
  } catch (error) {
    if (error instanceof ActionError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
