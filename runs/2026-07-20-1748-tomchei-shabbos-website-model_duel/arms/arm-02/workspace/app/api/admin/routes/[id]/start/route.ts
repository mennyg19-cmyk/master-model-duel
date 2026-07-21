import { requirePermissionApi } from "@/lib/auth/current-user";
import { ActionError } from "@/lib/packages/actions";
import { startRoute } from "@/lib/routes/service";
import { getOpenSeason } from "@/lib/season";

/** Start the route: IN_PROGRESS + idempotent day-of notifications (G-027). */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("fulfillment.manage");
  if ("response" in gate) return gate.response;
  const { id } = await context.params;

  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "No open season" }, { status: 409 });

  try {
    const { notified } = await startRoute(season.id, id, gate.staff.realUser.email);
    return Response.json({ ok: true, notified });
  } catch (error) {
    if (error instanceof ActionError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
