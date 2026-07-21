import { ActionError } from "@/lib/packages/actions";
import { resolveDriverAccess } from "@/lib/routes/driver-access";
import { startRoute } from "@/lib/routes/service";

/** Driver taps "Start route": IN_PROGRESS + day-of notifications (G-027). */
export async function POST(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const access = await resolveDriverAccess(token);
  if (!access.ok) {
    const status = access.reason === "pin_required" ? 401 : 404;
    return Response.json({ error: "This link cannot start the route" }, { status });
  }

  try {
    const { notified } = await startRoute(access.route.seasonId, access.route.id, `route-link:${access.linkId}`);
    return Response.json({ ok: true, notified });
  } catch (error) {
    if (error instanceof ActionError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
