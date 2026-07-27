import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { deleteMediaAsset } from "@/lib/media";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("media.manage");
  if ("response" in gate) return gate.response;

  const { id } = await params;
  const asset = await db.mediaAsset.findUnique({ where: { id } });
  if (!asset) return Response.json({ error: "Media asset not found" }, { status: 404 });

  await deleteMediaAsset(id);
  await writeAudit(gate.staff, {
    action: "media.delete",
    targetType: "MediaAsset",
    targetId: id,
    detail: { filename: asset.filename },
  });
  return Response.json({ ok: true });
}
