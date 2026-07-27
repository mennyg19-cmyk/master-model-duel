import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { saveMediaUpload } from "@/lib/media";

export async function GET() {
  const gate = await requirePermissionApi("media.manage");
  if ("response" in gate) return gate.response;

  const assets = await db.mediaAsset.findMany({
    include: { products: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return Response.json(assets);
}

export async function POST(request: Request) {
  const gate = await requirePermissionApi("media.manage");
  if ("response" in gate) return gate.response;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Send a multipart form with a \"file\" field." }, { status: 400 });
  }

  const outcome = await saveMediaUpload(file, gate.staff.actingAs.id);
  if (!outcome.ok) {
    return Response.json({ error: outcome.reason }, { status: 400 });
  }

  await writeAudit(gate.staff, {
    action: "media.upload",
    targetType: "MediaAsset",
    targetId: outcome.asset.id,
    detail: { filename: outcome.asset.filename, contentType: outcome.asset.contentType },
  });
  return Response.json({ ok: true, asset: outcome.asset }, { status: 201 });
}
