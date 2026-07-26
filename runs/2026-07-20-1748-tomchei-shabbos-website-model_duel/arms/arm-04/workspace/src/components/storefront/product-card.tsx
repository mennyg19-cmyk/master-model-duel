import Image from 'next/image';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { formatCents } from '@/lib/core/money';
import { highestPriceCents, lowestPriceCents, type CatalogProduct } from '@/lib/catalog/browse';

export function ProductPrice({ product }: { product: CatalogProduct }) {
  const lowest = lowestPriceCents(product);
  const highest = highestPriceCents(product);

  return (
    <span>
      {formatCents(lowest)}
      {highest > lowest ? ` – ${formatCents(highest)}` : ''}
    </span>
  );
}

export function ProductImage({
  product,
  className,
}: {
  product: CatalogProduct;
  className?: string;
}) {
  if (!product.imageUrl) {
    return (
      <div
        className={`flex items-center justify-center bg-[var(--color-surface-muted)] text-sm text-[var(--color-ink-muted)] ${className ?? ''}`}
      >
        Photo coming soon
      </div>
    );
  }

  return (
    <Image
      src={product.imageUrl}
      alt={product.imageAltText ?? product.name}
      width={640}
      height={480}
      className={className}
    />
  );
}

/**
 * `basePath` is the route the card links back into, so the same card serves the
 * live collection and an archive year without either one guessing the other's
 * URLs. Archive years pass `canOrder: false` and get no buy control at all.
 */
export function ProductCard({
  product,
  basePath,
  canOrder,
}: {
  product: CatalogProduct;
  basePath: string;
  canOrder: boolean;
}) {
  return (
    <article
      className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white"
      data-testid="product-card"
      data-slug={product.slug}
      data-category={product.category ?? ''}
      data-sold-out={product.isSoldOut ? 'true' : 'false'}
    >
      <ProductImage product={product} className="h-44 w-full object-cover" />

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold">
            <Link href={`${basePath}/${product.slug}`}>{product.name}</Link>
          </h3>
          {product.isSoldOut ? <Badge tone="danger">Sold out</Badge> : null}
        </div>

        {product.category ? (
          <p className="text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
            {product.category}
          </p>
        ) : null}

        <p className="text-sm text-[var(--color-ink-muted)]">{product.description}</p>

        <p className="mt-auto pt-2 font-medium">
          <ProductPrice product={product} />
        </p>

        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            href={`${basePath}?quick=${product.slug}`}
            className="text-[var(--color-brand)] underline underline-offset-4"
            data-testid="quick-view-link"
          >
            Quick view
          </Link>
          <Link href={`${basePath}/${product.slug}`} className="underline underline-offset-4">
            Full details
          </Link>
          {canOrder && !product.isSoldOut ? (
            <Link
              href={`/order?product=${product.slug}`}
              className="ml-auto font-medium text-[var(--color-brand)]"
              data-testid="product-order-cta"
            >
              Add to an order
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}
