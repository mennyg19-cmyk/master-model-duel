import Link from 'next/link';

import { ProductImage, ProductPrice } from './product-card';
import { Badge } from '@/components/ui/badge';
import { formatCents } from '@/lib/core/money';
import { optionGroups, type CatalogProduct } from '@/lib/catalog/browse';

/**
 * Quick view is a URL, not a JavaScript modal: `?quick=slug` renders this panel
 * above the grid. It is shareable, it survives a refresh, and it works with the
 * client bundle blocked — the same reason the mobile menu is a `<details>`.
 */
export function QuickView({
  product,
  basePath,
  closeHref,
  canOrder,
}: {
  product: CatalogProduct;
  basePath: string;
  closeHref: string;
  canOrder: boolean;
}) {
  return (
    <section
      aria-label={`Quick view: ${product.name}`}
      className="rounded-[var(--radius-card)] border border-[var(--color-brand)] bg-white p-5"
      data-testid="quick-view"
      data-slug={product.slug}
    >
      <div className="grid gap-5 sm:grid-cols-[minmax(0,14rem)_1fr]">
        <ProductImage
          product={product}
          className="h-40 w-full rounded-md object-cover sm:h-full"
        />

        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{product.name}</h2>
              <p className="mt-1 font-medium">
                <ProductPrice product={product} />
              </p>
            </div>
            {product.isSoldOut ? <Badge tone="danger">Sold out</Badge> : null}
          </div>

          <p className="text-sm text-[var(--color-ink-muted)]">{product.description}</p>

          {optionGroups(product).map((group) => (
            <p key={group.label} className="text-sm">
              <span className="font-medium">{group.label}:</span>{' '}
              {group.options
                .map(
                  (option) =>
                    `${option.label}${
                      option.priceAdjustmentCents === 0
                        ? ''
                        : ` (+${formatCents(option.priceAdjustmentCents)})`
                    }`,
                )
                .join(', ')}
            </p>
          ))}

          <div className="flex flex-wrap items-center gap-4 pt-1 text-sm">
            <Link
              href={`${basePath}/${product.slug}`}
              className="font-medium text-[var(--color-brand)] underline underline-offset-4"
            >
              Full details
            </Link>
            {canOrder && !product.isSoldOut ? (
              <Link href={`/order?product=${product.slug}`} className="font-medium">
                Add to an order
              </Link>
            ) : null}
            <Link href={closeHref} className="ml-auto text-[var(--color-ink-muted)]" data-testid="quick-view-close">
              Close
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
