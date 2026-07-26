import Link from 'next/link';

import { ProductImage, ProductPrice } from './product-card';
import { Badge } from '@/components/ui/badge';
import { formatCents } from '@/lib/core/money';
import { optionGroups, type CatalogProduct } from '@/lib/catalog/browse';

/**
 * One detail view for the live collection and for an archive year. The archive
 * passes `canOrder: false`, which is what keeps buy controls off historical
 * pages (G-022) without a second copy of this layout.
 */
export function ProductDetail({
  product,
  backHref,
  backLabel,
  canOrder,
}: {
  product: CatalogProduct;
  backHref: string;
  backLabel: string;
  canOrder: boolean;
}) {
  const groups = optionGroups(product);

  return (
    <article className="space-y-6" data-testid="product-detail" data-slug={product.slug}>
      <Link href={backHref} className="text-sm underline underline-offset-4">
        ← {backLabel}
      </Link>

      <div className="grid gap-8 md:grid-cols-2">
        <ProductImage
          product={product}
          className="h-72 w-full rounded-[var(--radius-card)] object-cover"
        />

        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-3xl font-semibold">{product.name}</h1>
            {product.isSoldOut ? <Badge tone="danger">Sold out</Badge> : null}
          </div>

          {product.category ? (
            <p className="text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
              {product.category}
            </p>
          ) : null}

          <p className="text-lg font-medium">
            <ProductPrice product={product} />
          </p>

          <p className="text-[var(--color-ink-muted)]">{product.description}</p>

          {groups.length > 0 ? (
            <div className="space-y-3" data-testid="option-pricing">
              {groups.map((group) => (
                <div key={group.label}>
                  <h2 className="text-sm font-semibold">{group.label}</h2>
                  <ul className="mt-1 divide-y divide-[var(--color-line)] rounded-md border border-[var(--color-line)]">
                    {group.options.map((option) => (
                      <li
                        key={`${group.label}-${option.label}`}
                        className="flex items-center justify-between px-3 py-2 text-sm"
                        data-option={option.label}
                      >
                        <span>{option.label}</span>
                        <span className="font-medium">
                          {formatCents(product.priceCents + option.priceAdjustmentCents)}
                          {option.priceAdjustmentCents === 0 ? '' : ` (+${formatCents(option.priceAdjustmentCents)})`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="text-sm text-[var(--color-ink-muted)]">
                Each choice is priced above. You pick one when you add the package to an order.
              </p>
            </div>
          ) : null}

          {canOrder && !product.isSoldOut ? (
            <Link
              href={`/order?product=${product.slug}`}
              className="inline-flex items-center rounded-md bg-[var(--color-brand)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-brand-strong)]"
              data-testid="detail-order-cta"
            >
              Add to an order
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}
