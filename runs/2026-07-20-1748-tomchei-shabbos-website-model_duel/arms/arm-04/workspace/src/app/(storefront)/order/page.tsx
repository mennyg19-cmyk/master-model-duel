import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/field';
import { findCatalogProduct } from '@/lib/catalog/queries';
import { formatCents } from '@/lib/core/money';
import { DELIVERY_AREA_MESSAGES, checkDeliveryAreaNow } from '@/lib/delivery-area';
import { requireOpenStore } from '@/lib/store-state';

export const dynamic = 'force-dynamic';

/**
 * The ordering entry point. P3 owns the two rules that must hold before anything
 * can be ordered — the store has to be open (R-002) and volunteer delivery only
 * reaches its ZIP list (G-014). The cart-first builder itself is P4 and lands
 * behind this same gate.
 */
export default async function OrderPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; zip?: string }>;
}) {
  const [{ product: productSlug, zip }, store] = await Promise.all([
    searchParams,
    requireOpenStore(),
  ]);

  const product = productSlug ? await findCatalogProduct(store.season.id, productSlug) : null;
  const deliveryCheck = zip ? await checkDeliveryAreaNow(zip) : null;

  return (
    <div className="max-w-2xl space-y-8">
      <header className="space-y-2">
        <Badge tone="success">{store.season.label} ordering is open</Badge>
        <h1 className="text-3xl font-semibold">Start an order</h1>
        <p className="text-[var(--color-ink-muted)]">
          The package builder arrives in the next release. Everything that decides whether an order
          can be placed at all is live now.
        </p>
      </header>

      {product ? (
        <Card data-testid="order-product">
          <CardTitle>{product.name}</CardTitle>
          <CardDescription>
            {formatCents(product.priceCents)} · carried into the builder when it ships.
          </CardDescription>
        </Card>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Can volunteers deliver to an address?</h2>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Volunteer delivery covers the ZIP codes our drivers reach. Shipping is available
          everywhere else.
        </p>

        <form method="get" action="/order" className="flex items-end gap-2">
          {productSlug ? <input type="hidden" name="product" value={productSlug} /> : null}
          <div>
            <Label htmlFor="zip">Recipient ZIP code</Label>
            <Input id="zip" name="zip" inputMode="numeric" defaultValue={zip ?? ''} required />
          </div>
          <Button type="submit" variant="secondary">
            Check
          </Button>
        </form>

        {deliveryCheck ? (
          <p
            className={
              deliveryCheck.deliverable
                ? 'text-sm text-[var(--color-success)]'
                : 'text-sm text-[var(--color-danger)]'
            }
            data-testid="delivery-result"
            data-deliverable={deliveryCheck.deliverable ? 'true' : 'false'}
          >
            {deliveryCheck.deliverable
              ? `Volunteers deliver to ${deliveryCheck.postalCode}.`
              : DELIVERY_AREA_MESSAGES[deliveryCheck.reason]}
          </p>
        ) : null}
      </section>

      <p className="text-sm text-[var(--color-ink-muted)]">
        <Link href="/collection" className="underline underline-offset-4">
          Back to the collection
        </Link>
      </p>
    </div>
  );
}
