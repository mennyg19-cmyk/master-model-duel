import { db } from "@/lib/db";
import { requirePermissionPage } from "@/lib/auth/current-user";
import { MediaLibrary } from "@/components/admin/media-library";

export default async function AdminMediaPage() {
  await requirePermissionPage("media.manage");
  const [productsWithoutPhotos, assets] = await Promise.all([
    db.product.findMany({
      where: { imageId: null, isActive: true },
      select: { id: true, name: true, season: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.mediaAsset.findMany({
      include: { products: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Media library</h1>
      <MediaLibrary
        needsPhotos={productsWithoutPhotos.map((product) => ({
          id: product.id,
          name: product.name,
          seasonName: product.season.name,
        }))}
        initialAssets={assets}
      />
    </div>
  );
}
