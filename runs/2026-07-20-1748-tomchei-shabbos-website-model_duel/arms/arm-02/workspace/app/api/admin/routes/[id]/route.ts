import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { getOpenSeason } from "@/lib/season";

const patchSchema = z.object({
  driverStaffId: z.string().nullable().optional(),
  name: z.string().min(1).max(120).optional(),
});

/** Reassign the driver or rename the route (R-075). */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("fulfillment.manage");
  if ("response" in gate) return gate.response;
  const { id } = await context.params;

  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "No open season" }, { status: 409 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Nothing valid to update" }, { status: 400 });

  const route = await db.deliveryRoute.findFirst({ where: { id, seasonId: season.id } });
  if (!route) return Response.json({ error: "Route not found" }, { status: 404 });

  if (parsed.data.driverStaffId) {
    const driver = await db.staffUser.findFirst({
      where: { id: parsed.data.driverStaffId, status: "ACTIVE" },
    });
    if (!driver) return Response.json({ error: "That staff member cannot take routes" }, { status: 400 });
  }

  await db.deliveryRoute.update({
    where: { id: route.id },
    data: {
      ...(parsed.data.driverStaffId !== undefined ? { driverStaffId: parsed.data.driverStaffId } : {}),
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
    },
  });
  await writeAudit(gate.staff, {
    action: "route.updated",
    targetType: "DeliveryRoute",
    targetId: route.id,
    detail: parsed.data,
  });
  return Response.json({ ok: true });
}
