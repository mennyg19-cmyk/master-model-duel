import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ProductCard } from '@/components/storefront/product-card';
import { QuickView } from '@/components/storefront/quick-view';
import { archivedSeasonCatalog, findSeasonByYear } from '@/lib/catalog/queries';
import { readStoreState } from '@/lib/store-state';

export const dynamic = 'force-dynamic';

export default async function ArchiveYearPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string }>;
  searchParams: Promise<{ quick?: string }>;
}) {
  const [{ year }, { quick }, store] = await Promise.all([params, searchParams, readStoreState()]);

  const parsedYear = Number(year);
  if (!Number.isInteger(parsedYear)) notFound();

  const season = await findSeasonByYear(parsedYear);
  // The season on display is the live collection, not archive material.
  if (!season || season.year === store.season?.year) notFound();

  const products = await archivedSeasonCatalog(season.id);
  const basePath = `/archive/${season.year}`;
  const quickProduct = quick ? products.find((product) => product.slug === quick) : undefined;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/archive" className="text-sm underline underline-offset-4">
          ← All past collections
        </Link>
        <h1 className="text-3xl font-semibold">{season.label}</h1>
        <p className="text-[var(--color-ink-muted)]" data-testid="archive-notice">
          This season is closed. You can look through everything it carried, but nothing here can be
          ordered.
        </p>
      </header>

      {quickProduct ? (
        <QuickView
          product={quickProduct}
          basePath={basePath}
          closeHref={basePath}
          canOrder={false}
        />
      ) : null}

      {products.length === 0 ? (
        <p className="text-[var(--color-ink-muted)]">No products were recorded for {season.year}.</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="product-grid">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} basePath={basePath} canOrder={false} />
          ))}
        </div>
      )}
    </div>
  );
}
