import Image from 'next/image';

import { UploadForm } from './upload-form';
import { NeedsPhotosCard } from '@/components/admin/needs-photos-card';
import { Badge } from '@/components/ui/badge';
import { requirePermission } from '@/lib/auth/staff';
import { formatDateTime } from '@/lib/core/dates';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { listMediaAssets, productsNeedingPhotos } from '@/lib/media/library';

export const dynamic = 'force-dynamic';

export default async function MediaLibraryPage() {
  await requirePermission('media.manage');

  const season =
    (await db.season.findFirst({ where: { status: 'OPEN' }, orderBy: { year: 'desc' } })) ??
    (await db.season.findFirst({ orderBy: { year: 'desc' } }));

  const [assets, needingPhotos] = await Promise.all([
    listMediaAssets(),
    season ? productsNeedingPhotos(season.id) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Media library</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Catalog photos. Uploads go to{' '}
          {env.MEDIA_STORAGE === 'blob' ? 'Vercel Blob' : 'local disk (development only)'}; assign one
          to a product from the product page.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Upload</h2>
        <UploadForm />
      </section>

      <NeedsPhotosCard
        products={needingPhotos}
        description={`Live in ${season?.label ?? 'the current season'} with a placeholder in the grid.`}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Library ({assets.length})</h2>

        {assets.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">Nothing uploaded yet.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="media-list">
            {assets.map((asset) => (
              <li
                key={asset.id}
                className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white"
                data-testid="media-item"
                data-pathname={asset.pathname}
              >
                <Image
                  src={asset.url}
                  alt={asset.altText}
                  width={480}
                  height={320}
                  className="h-36 w-full object-cover"
                />
                <div className="space-y-1 p-3 text-sm">
                  <p className="font-medium">{asset.originalFilename}</p>
                  <p className="text-[var(--color-ink-muted)]">{asset.altText}</p>
                  <p className="text-xs text-[var(--color-ink-muted)]">
                    {Math.round(asset.sizeBytes / 1024)} KB · {asset.contentType} ·{' '}
                    {formatDateTime(asset.createdAt)}
                  </p>
                  <Badge tone="neutral">
                    {asset.storage === 'VERCEL_BLOB' ? 'Vercel Blob' : 'Local disk'}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
