import { z } from "zod";
import { adminHandler } from "@/lib/api/admin-handler";
import { confirmReroute } from "@/lib/routes/service";

const schema = z.object({ packageId: z.string().min(1) });

/**
 * Manager-confirmed reroute (G-023): pull a nearby unshipped shipping package
 * onto this route — voids its label, switches the method, inserts the stop.
 * This endpoint IS the explicit confirm; suggestions alone never mutate.
 */
export const POST = adminHandler<{ id: string }, z.infer<typeof schema>>(
  { schema, invalidMessage: "Pick a package to reroute" },
  async ({ params, staff, season, body }) => {
    const stop = await confirmReroute(season.id, params.id, body.packageId, {
      id: staff.realUser.id,
      email: staff.realUser.email,
    });
    return Response.json({ ok: true, stopId: stop.id, position: stop.position });
  }
);
