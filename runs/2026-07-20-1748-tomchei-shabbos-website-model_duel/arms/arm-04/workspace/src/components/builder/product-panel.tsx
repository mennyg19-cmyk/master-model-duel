import Link from 'next/link';
import type { AddOn } from '@prisma/client';

import { ProductImage, ProductPrice } from '@/components/storefront/product-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/field';
import { optionGroups, type CatalogProduct } from '@/lib/catalog/browse';
import { formatCents } from '@/lib/core/money';

export type BuilderProduct = {
  product: CatalogProduct;
  /** Null for items that cannot run out, like a sponsorship. */
  unitsLeft: number | null;
  addOns: AddOn[];
};

/**
 * The left-hand half of the builder: what can go in the cart.
 *
 * Cards carry their own add form, so choosing options and quantity happens
 * before a recipient is ever mentioned — the cart-first order (UR-006, R-026).
 * Everything the panel needs arrives as props, including the action it posts to,
 * which is what lets the POS render the same panel later (R-031).
 */
export function BuilderProductPanel({
  items,
  addAction,
  quickViewHref,
}: {
  items: BuilderProduct[];
  addAction: (formData: FormData) => Promise<void>;
  quickViewHref: (slug: string) => string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid="builder-product-panel">
      {items.map(({ product, unitsLeft, addOns }) => (
        <BuilderProductCard
          key={product.id}
          product={product}
          unitsLeft={unitsLeft}
          addOns={addOns}
          addAction={addAction}
          quickViewHref={quickViewHref}
        />
      ))}
    </div>
  );
}

function BuilderProductCard({
  product,
  unitsLeft,
  addOns,
  addAction,
  quickViewHref,
}: BuilderProduct & {
  addAction: (formData: FormData) => Promise<void>;
  quickViewHref: (slug: string) => string;
}) {
  const soldOut = product.isSoldOut || unitsLeft === 0;

  return (
    <article
      className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white"
      data-testid="builder-product"
      data-slug={product.slug}
      data-units-left={unitsLeft === null ? 'unlimited' : String(unitsLeft)}
      data-sold-out={soldOut ? 'true' : 'false'}
    >
      <ProductImage product={product} className="h-32 w-full object-cover" />

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold">{product.name}</h3>
          {soldOut ? <Badge tone="danger">Sold out</Badge> : null}
        </div>

        <p className="font-medium">
          <ProductPrice product={product} />
        </p>

        <p className="text-xs text-[var(--color-ink-muted)]" data-testid="builder-stock">
          {stockLine(unitsLeft)}
        </p>

        <Link
          href={quickViewHref(product.slug)}
          className="text-sm text-[var(--color-brand)] underline underline-offset-4"
          data-testid="builder-quick-view-link"
        >
          Quick view
        </Link>

        {soldOut ? null : (
          <form action={addAction} className="mt-auto space-y-3 pt-2">
            <input type="hidden" name="productId" value={product.id} />
            <input type="hidden" name="slug" value={product.slug} />

            {optionGroups(product).map((group) => (
              <div key={group.label}>
                <Label htmlFor={`option-${product.slug}-${group.label}`}>{group.label}</Label>
                <Select
                  id={`option-${product.slug}-${group.label}`}
                  name={`option:${group.label}`}
                  defaultValue={group.options[0]?.label}
                >
                  {group.options.map((option) => (
                    <option key={option.label} value={option.label}>
                      {option.label}
                      {option.priceAdjustmentCents === 0
                        ? ''
                        : ` (+${formatCents(option.priceAdjustmentCents)})`}
                    </option>
                  ))}
                </Select>
              </div>
            ))}

            {addOns.length > 0 ? (
              <fieldset className="space-y-1" data-testid="builder-add-ons">
                <legend className="text-sm font-medium">Add something extra</legend>
                {addOns.map((addOn) => (
                  <label key={addOn.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="addOnIds" value={addOn.id} />
                    <span>
                      {addOn.name} · {formatCents(addOn.priceCents)}
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : null}

            <div className="flex items-end gap-2">
              <div className="w-20">
                <Label htmlFor={`quantity-${product.slug}`}>Qty</Label>
                <Input
                  id={`quantity-${product.slug}`}
                  name="quantity"
                  type="number"
                  min={1}
                  max={unitsLeft ?? 99}
                  defaultValue={1}
                  inputMode="numeric"
                />
              </div>
              <Button type="submit" className="flex-1" data-testid="builder-add">
                Add to order
              </Button>
            </div>
          </form>
        )}
      </div>
    </article>
  );
}

/**
 * Stock moves under everybody while carts are open — a draft holds nothing until
 * checkout reserves it — so the number is honest about being a snapshot rather
 * than a promise.
 */
function stockLine(unitsLeft: number | null): string {
  if (unitsLeft === null) return 'Always available';
  if (unitsLeft === 0) return 'Sold out';
  return `${unitsLeft} left right now · reserved when you pay`;
}
