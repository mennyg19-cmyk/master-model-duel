import { MediaManager } from "@/components/media-manager";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminMediaPage() {
  await requirePermission("settings:manage");
  const [assets, productsWithoutPhotos] = await Promise.all([
    db.mediaAsset.findMany({ orderBy: { createdAt: "desc" } }),
    db.product.findMany({
      where: {
        kind: "PACKAGE",
        isActive: true,
        imageUrl: null,
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, sku: true, version: true },
    }),
  ]);

  return (
    <MediaManager
      initialAssets={assets.map((asset) => ({
        id: asset.id,
        pathname: asset.pathname,
        url: asset.url,
        contentType: asset.contentType,
        sizeBytes: asset.sizeBytes,
      }))}
      initialProductsWithoutPhotos={productsWithoutPhotos}
    />
  );
}
