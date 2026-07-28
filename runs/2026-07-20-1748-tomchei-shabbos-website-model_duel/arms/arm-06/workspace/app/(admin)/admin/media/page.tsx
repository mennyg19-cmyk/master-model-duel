import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isBlobDriver } from "@/lib/media/storage";
import { MediaManager } from "@/app/(admin)/admin/media/media-manager";

export const metadata: Metadata = { title: "Media library" };
export const dynamic = "force-dynamic";

// R-067: product photo uploads and product assignment.
export default async function AdminMediaPage() {
  await requirePermission("catalog.manage");

  const [assets, products, needsPhotos] = await Promise.all([
    prisma.mediaAsset.findMany({
      orderBy: { createdAt: "desc" },
      include: { product: { select: { id: true, name: true } } },
    }),
    prisma.product.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.product.findMany({
      where: { active: true, media: { none: {} } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Media library</h1>
      <p className="mt-1 text-sm text-stone-600">
        Storage driver: <span className="font-medium">{isBlobDriver() ? "Vercel Blob" : "local (.uploads)"}</span>
        {!isBlobDriver() && " — set BLOB_READ_WRITE_TOKEN to switch to Blob."}
      </p>
      <MediaManager
        needsPhotos={needsPhotos}
        assets={assets.map((asset) => ({
          id: asset.id,
          url: asset.url,
          filename: asset.filename,
          sizeBytes: asset.sizeBytes,
          productId: asset.productId,
          productName: asset.product?.name ?? null,
        }))}
        products={products}
      />
    </div>
  );
}
