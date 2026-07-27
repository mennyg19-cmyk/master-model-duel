import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  line1: z.string().min(1).max(200).optional(),
  city: z.string().min(1).max(100).optional(),
  state: z.string().length(2).optional(),
  zip: z.string().regex(/^\d{5}$/).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("settings.manage");
  if ("response" in gate) return gate.response;

  const { id } = await params;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const existing = await db.pickupLocation.findUnique({ where: { id } });
  if (!existing) return Response.json({ error: "Pickup location not found" }, { status: 404 });

  await db.pickupLocation.update({ where: { id }, data: parsed.data });
  await writeAudit(gate.staff, { action: "settings.pickup_location.update", targetType: "PickupLocation", targetId: id, detail: parsed.data });
  return Response.json({ ok: true });
}
