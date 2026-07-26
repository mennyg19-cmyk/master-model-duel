import Link from 'next/link';

import { CatalogControls } from '@/components/storefront/catalog-controls';
import { ProductCard } from '@/components/storefront/product-card';
import { QuickView } from '@/components/storefront/quick-view';
import { browseCatalog, catalogHref, categoriesOf, isCatalogSort, DEFAULT_SORT } from '@/lib/catalog/browse';
import { currentSeasonCatalog } from '@/lib/catalog/queries';
import { readStoreState } from '@/lib/store-state';

export const dynamic = 'force-dynamic';

const BASE_PATH = '/collection';

type SearchParams = { category?: string; sort?: string; quick?: string };

export default async function CollectionPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [{ category, sort, quick }, store] = await Promise.all([searchParams, readStoreState()]);

  if (!store.season) {
    return (
      <p className="text-[var(--color-ink-muted)]">
        No season has been set up yet. <Link href="/archive">Past collections</Link> are still here.
      </p>
    );
  }

  const products = await currentSeasonCatalog(store.season.id);
  const categories = categoriesOf(products);
  // An unknown category would otherwise render an empty grid with no explanation.
  const activeCategory = category && categories.includes(category) ? category : null;
  const activeSort = isCatalogSort(sort) ? sort : DEFAULT_SORT;

  const visible = browseCatalog(products, {
    category: activeCategory ?? undefined,
    sort: activeSort,
  });
  const quickProduct = quick ? visible.find((product) => product.slug === quick) : undefined;

  const closeHref = catalogHref(BASE_PATH, { category: activeCategory, sort: activeSort });

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">{store.season.label} collection</h1>
        <p className="text-[var(--color-ink-muted)]">
          {store.isOpen
            ? 'Pick the packages you want to send. Recipients come next.'
            : 'Browsing is open all year. Ordering opens when the season does.'}
        </p>
      </header>

      <CatalogControls
        basePath={BASE_PATH}
        categories={categories}
        activeCategory={activeCategory}
        activeSort={activeSort}
        resultCount={visible.length}
      />

      {quickProduct ? (
        <QuickView
          product={quickProduct}
          basePath={BASE_PATH}
          closeHref={closeHref}
          canOrder={store.isOpen}
        />
      ) : null}

      {visible.length === 0 ? (
        <p className="text-[var(--color-ink-muted)]">
          Nothing in this category yet. <Link href={BASE_PATH}>See everything</Link>.
        </p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="product-grid">
          {visible.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              basePath={BASE_PATH}
              canOrder={store.isOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
}