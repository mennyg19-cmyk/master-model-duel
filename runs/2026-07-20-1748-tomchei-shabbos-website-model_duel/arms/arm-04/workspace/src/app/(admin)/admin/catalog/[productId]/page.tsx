import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ProductForm } from '../product-form';
import { ReplacementForm } from './replacement-form';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { requirePermission } from '@/lib/auth/staff';
import { db } from '@/lib/db';
import { listMediaAssets } from '@/lib/media/library';

export const dynamic = 'force-dynamic';

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  await requirePermission('catalog.manage');
  const { productId } = await params;

  const product = await db.product.findUnique({
    where: { id: productId },
    include: { season: true, options: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!product) notFound();

  const [seasons, images, laterProducts] = await Promise.all([
    db.season.findMany({ orderBy: { year: 'desc' } }),
    listMediaAssets(),
    // Only products from a later season can replace this one, which is the same
    // rule `setReplacementLink` enforces on the way in.
    db.product.findMany({
      where: { season: { year: { gt: product.season.year } } },
      include: { season: true },
      orderBy: [{ season: { year: 'desc' } }, { name: 'asc' }],
    }),
  ]);

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <Link href="/admin/catalog" className="text-sm underline underline-offset-4">
          ← Catalog
        </Link>
        <h1 className="text-2xl font-semibold">{product.name}</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          {product.season.label} · {product.slug}
        </p>
      </header>

      <ProductForm
        seasons={seasons.map((season) => ({ id: season.id, label: season.label }))}
        seasonId={product.seasonId}
        images={images.map((image) => ({ id: image.id, label: image.originalFilename }))}
        values={{
          productId: product.id,
          slug: product.slug,
          name: product.name,
          description: product.description ?? '',
          category: product.category ?? '',
          kind: product.kind,
          priceDollars: (product.priceCents / 100).toFixed(2),
          lengthMm: product.lengthMm?.toString() ?? '',
          widthMm: product.widthMm?.toString() ?? '',
          heightMm: product.heightMm?.toString() ?? '',
          weightGrams: product.weightGrams?.toString() ?? '',
          imageAssetId: product.imageAssetId ?? '',
          tracksInventory: product.tracksInventory,
          isActive: product.isActive,
          sortOrder: product.sortOrder,
        }}
        submitLabel="Save product"
      />

      <Card data-testid="replacement-editor">
        <CardTitle>Replaced by</CardTitle>
        <CardDescription>
          Point this product at the one that takes its place in a later season. Repeat-order uses the
          link to suggest a swap; the mapping screens themselves come with seasons management.
        </CardDescription>

        <ReplacementForm
          productId={product.id}
          replacedByProductId={product.replacedByProductId}
          candidates={laterProducts.map((candidate) => ({
            id: candidate.id,
            label: `${candidate.season.label} — ${candidate.name}`,
          }))}
        />
      </Card>

      {product.options.length > 0 ? (
        <Card>
          <CardTitle>Options</CardTitle>
          <CardDescription>
            Priced choices the storefront shows on the detail page. Editing them is part of the
            season wizard; they are read-only here.
          </CardDescription>
          <ul className="mt-3 space-y-1 text-sm">
            {product.options.map((option) => (
              <li key={option.id}>
                {option.groupLabel}: {option.label}
                {option.priceAdjustmentCents === 0
                  ? ''
                  : ` (+$${(option.priceAdjustmentCents / 100).toFixed(2)})`}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
