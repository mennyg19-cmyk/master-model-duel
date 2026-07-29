import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { putObject } from "@/lib/media/storage";
import { sniffImageType, validateUpload } from "@/lib/media/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireApiPermission("catalog.manage");
  if (!gate.ok) return gate.response;

  const assets = await prisma.mediaAsset.findMany({
    orderBy: { createdAt: "desc" },
    include: { product: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ assets });
}

// R-067/R-128/R-180: validated upload — allowlisted image types only, size
// capped, extension must match the declared type; bytes go to the storage
// driver (Vercel Blob when configured, local seam otherwise).
export async function POST(request: Request) {
  const gate = await requireApiPermission("catalog.manage");
  if (!gate.ok) return gate.response;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: "An image file is required" }, { status: 400 });
  }

  const verdict = validateUpload({
    filename: file.name,
    contentType: file.type,
    sizeBytes: file.size,
  });
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.error }, { status: 400 });
  }

  const productIdRaw = form.get("productId");
  const productId = typeof productIdRaw === "string" && productIdRaw ? productIdRaw : null;
  if (productId) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { season: { select: { name: true, status: true } } },
    });
    if (!product) {
      return NextResponse.json({ error: "Unknown product for the photo assignment" }, { status: 400 });
    }
    // Same open-season gate as ordering/imports: catalog edits target the
    // live season, never a closed one.
    if (product.season.status !== "OPEN") {
      return NextResponse.json(
        { error: `Season ${product.season.name} is ${product.season.status.toLowerCase()}; photos attach to open-season products` },
        { status: 422 },
      );
    }
  }

  const storedName = `${crypto.randomUUID()}.${verdict.extension}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (sniffImageType(bytes) !== file.type) {
    return NextResponse.json(
      { error: "The file contents do not match the declared image type" },
      { status: 400 },
    );
  }
  const stored = await putObject({ storedName, contentType: file.type, bytes });

  const asset = await prisma.mediaAsset.create({
    data: {
      url: stored.url,
      storedName: stored.storedName,
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      driver: stored.driver,
      productId,
      uploadedById: gate.ctx.staff.id,
    },
  });
  await recordAudit({
    ctx: gate.ctx,
    action: "media_upload",
    targetType: "MediaAsset",
    targetId: asset.id,
    metadata: { filename: asset.filename, driver: asset.driver, sizeBytes: asset.sizeBytes },
  });

  return NextResponse.json({ asset }, { status: 201 });
}
