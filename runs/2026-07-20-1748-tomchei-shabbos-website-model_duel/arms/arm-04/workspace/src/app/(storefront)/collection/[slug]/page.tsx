import { notFound } from 'next/navigation';

import { ProductDetail } from '@/components/storefront/product-detail';
import { findCatalogProduct } from '@/lib/catalog/queries';
import { readStoreState } from '@/lib/store-state';

export const dynamic = 'force-dynamic';

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const [{ slug }, store] = await Promise.all([params, readStoreState()]);
  if (!store.season) notFound();

  const product = await findCatalogProduct(store.season.id, slug);
  if (!product) notFound();

  return (
    <ProductDetail
      product={product}
      backHref="/collection"
      backLabel={`Back to the ${store.season.label} collection`}
      canOrder={store.isOpen}
    />
  );
}
