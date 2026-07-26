import Link from 'next/link';

import { EMPTY_PRODUCT, ProductForm } from './product-form';
import { NeedsPhotosCard } from '@/components/admin/needs-photos-card';
import { SeasonSelectForm } from '@/components/admin/season-select-form';
import { Badge } from '@/components/ui/badge';
import { requirePermission } from '@/lib/auth/staff';
import { formatCents } from '@/lib/core/money';
import { db } from '@/lib/db';
import { listMediaAssets, productsNeedingPhotos } from '@/lib/media/library';

export const dynamic = 'force-dynamic';

export default async function AdminCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  await requirePermission('catalog.manage');
  const { season: requestedSeason } = await searchParams;

  const seasons = await db.season.findMany({ orderBy: { year: 'desc' } });
  if (seasons.length === 0) {
    return (
      <p className="text-[var(--color-ink-muted)]">
        No season exists yet, so there is nothing to put a product in. Seasons are created by the
        seed today and by the season wizard in a later phase.
      </p>
    );
  }

  const selected =
    seasons.find((season) => String(season.year) === requestedSeason) ??
    seasons.find((season) => season.status === 'OPEN') ??
    seasons[0];

  const [products, images, needingPhotos] = await Promise.all([
    db.product.findMany({
      where: { seasonId: selected.id },
      include: { inventory: true, image: true, replacedBy: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    listMediaAssets(),
    productsNeedingPhotos(selected.id),
  ]);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Catalog</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Products for one season at a time. Add-ons have their own page.
          </p>
        </div>

        <div className="flex items-end gap-4">
          <SeasonSelectForm
            action="/admin/catalog"
            seasons={seasons}
            selectedYear={selected.year}
          />

          <Link href="/admin/catalog/add-ons" className="pb-2 text-sm underline underline-offset-4">
            Add-ons
          </Link>
        </div>
      </header>

      <NeedsPhotosCard
        products={needingPhotos}
        description="These are live in the collection with a placeholder where the photo goes."
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{selected.label} products</h2>

        {products.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">Nothing in this season yet.</p>
        ) : (
          <table className="w-full text-left text-sm" data-testid="product-table">
            <thead className="border-b border-[var(--color-line)] text-[var(--color-ink-muted)]">
              <tr>
                <th className="py-2">Product</th>
                <th className="py-2">Category</th>
                <th className="py-2">Price</th>
                <th className="py-2">Stock</th>
                <th className="py-2">Photo</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-b border-[var(--color-line)]">
                  <td className="py-2">
                    <Link
                      href={`/admin/catalog/${product.id}`}
                      className="underline underline-offset-4"
                    >
                      {product.name}
                    </Link>
                    <span className="block text-xs text-[var(--color-ink-muted)]">{product.slug}</span>
                  </td>
                  <td className="py-2">{product.category ?? '—'}</td>
                  <td className="py-2">{formatCents(product.priceCents)}</td>
                  <td className="py-2">
                    {product.tracksInventory
                      ? product.inventory
                        ? `${product.inventory.onHand - product.inventory.reserved} available`
                        : 'not set up'
                      : 'untracked'}
                  </td>
                  <td className="py-2">{product.image ? 'yes' : 'missing'}</td>
                  <td className="py-2">
                    <Badge tone={product.isActive ? 'success' : 'neutral'}>
                      {product.isActive ? 'Live' : 'Hidden'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Add a product</h2>
        <ProductForm
          seasons={seasons.map((season) => ({ id: season.id, label: season.label }))}
          seasonId={selected.id}
          images={images.map((image) => ({ id: image.id, label: image.originalFilename }))}
          values={EMPTY_PRODUCT}
          submitLabel="Create product"
        />
      </section>
    </div>
  );
}
