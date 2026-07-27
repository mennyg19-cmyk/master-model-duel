import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";

export async function GET() {
  const gate = await requirePermissionApi("settings.manage");
  if ("response" in gate) return gate.response;
  return Response.json(await db.pickupLocation.findMany({ orderBy: { name: "asc" } }));
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  line1: z.string().min(1).max(200),
  city: z.string().min(1).max(100),
  state: z.string().length(2),
  zip: z.string().regex(/^\d{5}$/),
});

export async function POST(request: Request) {
  const gate = await requirePermissionApi("settings.manage");
  if ("response" in gate) return gate.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const location = await db.pickupLocation.create({ data: parsed.data });
  await writeAudit(gate.staff, { action: "settings.pickup_location.create", targetType: "PickupLocation", targetId: location.id, detail: { name: location.name } });
  return Response.json({ ok: true, id: location.id }, { status: 201 });
}
