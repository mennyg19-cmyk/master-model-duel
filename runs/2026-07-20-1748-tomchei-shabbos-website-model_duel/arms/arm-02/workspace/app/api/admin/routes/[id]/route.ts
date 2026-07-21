import { z } from "zod";
import { db } from "@/lib/db";
import { adminHandler } from "@/lib/api/admin-handler";
import { writeAudit } from "@/lib/audit";

const patchSchema = z.object({
  driverStaffId: z.string().nullable().optional(),
  name: z.string().min(1).max(120).optional(),
});

/** Reassign the driver or rename the route (R-075). */
export const PATCH = adminHandler<{ id: string }, z.infer<typeof patchSchema>>(
  { schema: patchSchema, invalidMessage: "Nothing valid to update" },
  async ({ params, staff, season, body }) => {
    const route = await db.deliveryRoute.findFirst({ where: { id: params.id, seasonId: season.id } });
    if (!route) return Response.json({ error: "Route not found" }, { status: 404 });

    if (body.driverStaffId) {
      const driver = await db.staffUser.findFirst({
        where: { id: body.driverStaffId, status: "ACTIVE" },
      });
      if (!driver) return Response.json({ error: "That staff member cannot take routes" }, { status: 400 });
    }

    await db.deliveryRoute.update({
      where: { id: route.id },
      data: {
        ...(body.driverStaffId !== undefined ? { driverStaffId: body.driverStaffId } : {}),
        ...(body.name ? { name: body.name } : {}),
      },
    });
    await writeAudit(staff, {
      action: "route.updated",
      targetType: "DeliveryRoute",
      targetId: route.id,
      detail: body,
    });
    return Response.json({ ok: true });
  }
);
