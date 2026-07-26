import { notFound } from 'next/navigation';

import { ProductDetail } from '@/components/storefront/product-detail';
import { findCatalogProduct, findSeasonByYear } from '@/lib/catalog/queries';
import { readStoreState } from '@/lib/store-state';

export const dynamic = 'force-dynamic';

export default async function ArchivedProductPage({
  params,
}: {
  params: Promise<{ year: string; slug: string }>;
}) {
  const [{ year, slug }, store] = await Promise.all([params, readStoreState()]);

  const parsedYear = Number(year);
  if (!Number.isInteger(parsedYear)) notFound();

  const season = await findSeasonByYear(parsedYear);
  if (!season || season.year === store.season?.year) notFound();

  const product = await findCatalogProduct(season.id, slug);
  if (!product) notFound();

  return (
    <ProductDetail
      product={product}
      backHref={`/archive/${season.year}`}
      backLabel={`Back to ${season.label}`}
      canOrder={false}
    />
  );
}
