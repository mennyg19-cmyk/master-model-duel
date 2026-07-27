import { z } from "zod";
import { adminHandler } from "@/lib/api/admin-handler";
import { writeAudit } from "@/lib/audit";
import { buildRoute } from "@/lib/routes/service";

const createSchema = z.object({
  methodId: z.string().min(1),
  name: z.string().max(120).optional(),
  maxStops: z.number().int().min(1).max(200).optional(),
});

/** Build a delivery route from unassigned packages (R-074). */
export const POST = adminHandler(
  { schema: createSchema, invalidMessage: "Pick a delivery method" },
  async ({ staff, season, body }) => {
    const { route, stopCount } = await buildRoute(season.id, body, staff.realUser.id);
    await writeAudit(staff, {
      action: "route.created",
      targetType: "DeliveryRoute",
      targetId: route.id,
      detail: { name: route.name, stopCount },
    });
    return Response.json({ ok: true, routeId: route.id, stopCount });
  }
);
