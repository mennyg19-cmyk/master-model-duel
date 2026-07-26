import Link from 'next/link';

import {
  addToCartAction,
  assignLineAction,
  changeQuantityAction,
  removeLineAction,
  saveBuilderAddressAction,
  unassignLineAction,
} from './actions';
import {
  AddRecipientPanel,
  AssignmentPanel,
  SavedAddressEditor,
  type AssignmentLinks,
  type AssignmentOptions,
} from '@/components/builder/assignment-panel';
import { CartPanel } from '@/components/builder/cart-panel';
import { BuilderProductPanel, type BuilderProduct } from '@/components/builder/product-panel';
import { QuickView } from '@/components/storefront/quick-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import { listCustomerAddresses } from '@/lib/addresses/address-book';
import { currentSeasonCatalog } from '@/lib/catalog/queries';
import { getCurrentCustomer } from '@/lib/customers';
import { DELIVERY_AREA_MESSAGES, checkDeliveryAreaNow } from '@/lib/delivery-area';
import { db } from '@/lib/db';
import { BUILDER_PATH, CHECKOUT_PATH, builderHref, type BuilderParams } from '@/lib/orders/builder-href';
import { addOnsFor, readAddOnOffers, readCart, readProductAvailability } from '@/lib/orders/cart';
import { readGuestOwner } from '@/lib/orders/draft-access';
import { requireOpenStore } from '@/lib/store-state';

export const dynamic = 'force-dynamic';

/**
 * The cart-first order builder (UR-006, G-018).
 *
 * Items and quantities go in first with no recipient at all; each line is then
 * pointed at the person it is for. The gates P3 put on this route still hold —
 * the store has to be open (R-002) and volunteer delivery only reaches its ZIP
 * list (G-014) — and the ZIP checker stays on the page because "can you even
 * drive here?" is the first question people ask.
 */
export default async function OrderPage({
  searchParams,
}: {
  searchParams: Promise<BuilderParams>;
}) {
  const [params, store] = await Promise.all([searchParams, requireOpenStore()]);
  const season = store.season;

  const customer = await getCurrentCustomer();
  const owner = customer
    ? ({ kind: 'customer', customerId: customer.id } as const)
    : await readGuestOwner();

  const [products, availability, cart, addresses, methods, pickupLocations, addOnOffers] =
    await Promise.all([
      currentSeasonCatalog(season.id),
      readProductAvailability(season.id),
      owner ? readCart(owner, season.id) : null,
      customer ? listCustomerAddresses(customer.id) : [],
      db.fulfillmentMethod.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      db.pickupLocation.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      readAddOnOffers(season.id),
    ]);

  const items: BuilderProduct[] = products.map((product) => ({
    product,
    unitsLeft: availability.get(product.id) ?? null,
    addOns: addOnsFor(addOnOffers, product.id),
  }));

  const quickProduct = params.quick
    ? (products.find((product) => product.slug === params.quick) ?? null)
    : null;
  const highlighted = params.product
    ? (products.find((product) => product.slug === params.product) ?? null)
    : null;

  const openLine = params.assign
    ? (cart?.lines.find((line) => line.id === params.assign) ?? null)
    : null;
  const editingAddress =
    params.editAddress && customer
      ? (addresses.find((address) => address.id === params.editAddress) ?? null)
      : null;

  const assignmentOptions: AssignmentOptions = {
    methods,
    pickupLocations,
    addresses,
    selfName: customer?.fullName ?? null,
  };

  const deliveryCheck = params.zip ? await checkDeliveryAreaNow(params.zip) : null;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Badge tone="success">{season.label} ordering is open</Badge>
        <h1 className="text-3xl font-semibold">Build your order</h1>
        <p className="text-[var(--color-ink-muted)]">
          Add the packages you want, then say who each one is going to. Your order saves itself as
          you go{customer ? '' : ' — signing in is only needed at checkout'}.
        </p>
      </header>

      {params.notice ? (
        <p
          className="rounded-md bg-[var(--color-success-soft)] px-3 py-2 text-sm text-[var(--color-success)]"
          data-testid="builder-notice"
        >
          {params.notice}
        </p>
      ) : null}

      {params.problem ? (
        <p
          role="alert"
          className="rounded-md bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
          data-testid="builder-problem"
        >
          {params.problem}
        </p>
      ) : null}

      {openLine && editingAddress ? (
        <SavedAddressEditor
          address={editingAddress}
          line={openLine}
          saveAddressAction={saveBuilderAddressAction}
          cancelHref={builderHref(BUILDER_PATH, { assign: openLine.id })}
        />
      ) : null}

      {openLine && !editingAddress ? (
        params.add ? (
          <AddRecipientPanel
            line={openLine}
            options={assignmentOptions}
            links={linksFor(openLine.id)}
            assignAction={assignLineAction}
          />
        ) : (
          <AssignmentPanel
            line={openLine}
            options={assignmentOptions}
            links={linksFor(openLine.id)}
            assignAction={assignLineAction}
          />
        )
      ) : null}

      {quickProduct ? (
        <QuickView
          product={quickProduct}
          basePath="/collection"
          closeHref={builderHref(BUILDER_PATH, { product: params.product })}
          canOrder={false}
        />
      ) : null}

      {highlighted ? (
        <p className="text-sm text-[var(--color-ink-muted)]" data-testid="order-product">
          Came from the collection: <strong>{highlighted.name}</strong> is in the list below.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <BuilderProductPanel
          items={items}
          addAction={addToCartAction}
          quickViewHref={(slug) => builderHref(BUILDER_PATH, { quick: slug, product: params.product })}
        />

        <div className="space-y-6">
          <CartPanel
            cart={cart}
            actions={cartActions}
            assignHref={(lineId) => builderHref(BUILDER_PATH, { assign: lineId })}
            checkoutHref={CHECKOUT_PATH}
            className="hidden lg:sticky lg:top-4 lg:block"
            testId="cart-sidebar"
          />

          <section className="space-y-3 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4">
            <h2 className="text-base font-semibold">Can volunteers deliver to an address?</h2>
            <p className="text-sm text-[var(--color-ink-muted)]">
              Volunteer delivery covers the ZIP codes our drivers reach. Shipping is available
              everywhere else.
            </p>

            <form method="get" action={BUILDER_PATH} className="flex items-end gap-2">
              {params.product ? <input type="hidden" name="product" value={params.product} /> : null}
              <div>
                <Label htmlFor="zip">Recipient ZIP code</Label>
                <Input id="zip" name="zip" inputMode="numeric" defaultValue={params.zip ?? ''} required />
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
        </div>
      </div>

      {/* The phone's cart: the button jumps to it, which is a scroll a browser
          does on its own rather than a sheet component that needs JavaScript. */}
      <div id="cart-sheet" className="scroll-mt-4 lg:hidden">
        <CartPanel
          cart={cart}
          actions={cartActions}
          assignHref={(lineId) => builderHref(BUILDER_PATH, { assign: lineId })}
          checkoutHref={CHECKOUT_PATH}
          testId="cart-sheet"
        />
      </div>

      <a
        href="#cart-sheet"
        className="fixed bottom-4 right-4 z-20 rounded-full bg-[var(--color-brand)] px-4 py-3 text-sm font-medium text-white shadow-lg lg:hidden"
        data-testid="mobile-cart-fab"
      >
        Order · {cart?.itemCount ?? 0} item{cart?.itemCount === 1 ? '' : 's'}
      </a>

      <p className="text-sm text-[var(--color-ink-muted)]">
        <Link href="/collection" className="underline underline-offset-4">
          Back to the collection
        </Link>
        {customer ? (
          <>
            {' · '}
            <Link href="/account" className="underline underline-offset-4">
              Your account
            </Link>
          </>
        ) : (
          <>
            {' · '}
            <Link href="/account/sign-in" className="underline underline-offset-4">
              Sign in to save your address book
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

const cartActions = {
  changeQuantity: changeQuantityAction,
  removeLine: removeLineAction,
  unassignLine: unassignLineAction,
};

function linksFor(lineId: string): AssignmentLinks {
  return {
    addRecipientHref: builderHref(BUILDER_PATH, { assign: lineId, add: '1' }),
    pickRecipientHref: builderHref(BUILDER_PATH, { assign: lineId }),
    editAddressHref: (addressId) => builderHref(BUILDER_PATH, { assign: lineId, editAddress: addressId }),
    closeHref: BUILDER_PATH,
  };
}
