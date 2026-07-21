import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";

export async function GET() {
  const gate = await requirePermissionApi("settings.manage");
  if ("response" in gate) return gate.response;
  return Response.json(await db.packageType.findMany({ orderBy: { name: "asc" } }));
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  widthCm: z.number().positive().nullish(),
  lengthCm: z.number().positive().nullish(),
  heightCm: z.number().positive().nullish(),
  weightGrams: z.number().int().positive().nullish(),
});

export async function POST(request: Request) {
  const gate = await requirePermissionApi("settings.manage");
  if ("response" in gate) return gate.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const duplicate = await db.packageType.findUnique({ where: { name: parsed.data.name } });
  if (duplicate) {
    return Response.json({ error: `Package type "${parsed.data.name}" already exists` }, { status: 409 });
  }
  const packageType = await db.packageType.create({ data: parsed.data });
  await writeAudit(gate.staff, { action: "settings.package_type.create", targetType: "PackageType", targetId: packageType.id, detail: { name: packageType.name } });
  return Response.json({ ok: true, id: packageType.id }, { status: 201 });
}
