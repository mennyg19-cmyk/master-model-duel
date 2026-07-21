import { z } from "zod";
import { db } from "@/lib/db";
import { adminHandler } from "@/lib/api/admin-handler";
import { writeAudit } from "@/lib/audit";
import { createRouteLink } from "@/lib/routes/links";

const createSchema = z.object({
  pin: z
    .string()
    .regex(/^\d{4}$/, "PIN is 4 digits")
    .nullable()
    .optional(),
});

/**
 * Mint (or rotate) the route's driver magic link (UR-004). The token is
 * returned exactly once — only its hash is stored. The manager texts the PIN
 * separately when one is set.
 */
export const POST = adminHandler<{ id: string }, z.infer<typeof createSchema>>(
  { schema: createSchema, emptyBody: {} },
  async ({ params, staff, season, body }) => {
    const route = await db.deliveryRoute.findFirst({ where: { id: params.id, seasonId: season.id } });
    if (!route) return Response.json({ error: "Route not found" }, { status: 404 });
    if (route.status === "COMPLETED") {
      return Response.json({ error: "This route already completed — links stay expired" }, { status: 409 });
    }

    const { link, url } = await createRouteLink(route.id, body.pin ?? null, staff.realUser.id);
    await writeAudit(staff, {
      action: "route.link.created",
      targetType: "DeliveryRoute",
      targetId: route.id,
      detail: { linkId: link.id, pinProtected: Boolean(body.pin) },
    });
    return Response.json({ ok: true, url, linkId: link.id });
  }
);
