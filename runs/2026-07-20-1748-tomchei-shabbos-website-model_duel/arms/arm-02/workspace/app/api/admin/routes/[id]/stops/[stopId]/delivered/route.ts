import { adminHandler } from "@/lib/api/admin-handler";
import { markStopDelivered } from "@/lib/routes/service";

/** Printed-fallback path: staff mark a stop delivered from route detail. */
export const POST = adminHandler<{ id: string; stopId: string }>({}, async ({ params, staff, season }) => {
  const outcome = await markStopDelivered(season.id, params.id, params.stopId, {
    kind: "staff",
    staffId: staff.realUser.id,
    staffEmail: staff.realUser.email,
  });
  return Response.json({ ok: true, routeCompleted: outcome.completed });
});
