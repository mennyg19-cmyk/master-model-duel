import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("settings.manage");
  if ("response" in gate) return gate.response;

  const { id } = await params;
  const existing = await db.packageType.findUnique({ where: { id } });
  if (!existing) return Response.json({ error: "Package type not found" }, { status: 404 });

  await db.packageType.delete({ where: { id } });
  await writeAudit(gate.staff, { action: "settings.package_type.delete", targetType: "PackageType", targetId: id, detail: { name: existing.name } });
  return Response.json({ ok: true });
}
