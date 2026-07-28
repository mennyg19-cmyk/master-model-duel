import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { deleteObject } from "@/lib/media/storage";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

const patchSchema = z.object({
  productId: z.string().nullable(),
});

// R-067: assign/unassign a photo to a product (SetNull keeps the library row
// when the product goes away).
export async function PATCH(request: Request, { params }: Props) {
  const gate = await requireApiPermission("catalog.manage");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const parsed = await parseBody(request, patchSchema, "productId is required");
  if (!parsed.ok) return parsed.response;

  const existing = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Media asset not found" }, { status: 404 });
  }

  if (parsed.data.productId) {
    const product = await prisma.product.findUnique({ where: { id: parsed.data.productId } });
    if (!product) {
      return NextResponse.json({ error: "Unknown product for the photo assignment" }, { status: 400 });
    }
  }

  const asset = await prisma.mediaAsset.update({
    where: { id },
    data: { productId: parsed.data.productId },
  });
  await recordAudit({
    ctx: gate.ctx,
    action: "media_update",
    targetType: "MediaAsset",
    targetId: asset.id,
    metadata: { productId: asset.productId },
  });

  return NextResponse.json({ asset });
}

export async function DELETE(_request: Request, { params }: Props) {
  const gate = await requireApiPermission("catalog.manage");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const existing = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Media asset not found" }, { status: 404 });
  }

  await prisma.mediaAsset.delete({ where: { id } });
  await deleteObject(existing.storedName, existing.driver);
  await recordAudit({
    ctx: gate.ctx,
    action: "media_delete",
    targetType: "MediaAsset",
    targetId: id,
    metadata: { storedName: existing.storedName },
  });

  return NextResponse.json({ ok: true });
}
