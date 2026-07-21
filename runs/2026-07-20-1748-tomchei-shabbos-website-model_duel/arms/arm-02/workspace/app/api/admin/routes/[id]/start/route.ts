import { adminHandler } from "@/lib/api/admin-handler";
import { startRoute } from "@/lib/routes/service";

/** Start the route: IN_PROGRESS + idempotent day-of notifications (G-027). */
export const POST = adminHandler<{ id: string }>({}, async ({ params, staff, season }) => {
  const { notified } = await startRoute(season.id, params.id, staff.realUser.email);
  return Response.json({ ok: true, notified });
});
