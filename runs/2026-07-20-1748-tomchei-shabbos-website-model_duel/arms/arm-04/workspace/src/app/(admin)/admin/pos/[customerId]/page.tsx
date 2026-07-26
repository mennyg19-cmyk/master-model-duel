import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  addToCartAtCounter,
  assignLineAtCounter,
  changeQuantityAtCounter,
  discardCounterCart,
  removeLineAtCounter,
  saveAddressAtCounter,
  unassignLineAtCounter,
} from '../actions';
import { BackLink } from '@/components/admin/list-controls';
import {
  AddRecipientPanel,
  AssignmentPanel,
  SavedAddressEditor,
  type AssignmentLinks,
  type AssignmentOptions,
} from '@/components/builder/assignment-panel';
import { CartPanel } from '@/components/builder/cart-panel';
import { BuilderProductPanel, type BuilderProduct } from '@/components/builder/product-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FlashMessages } from '@/components/ui/flash';
import { listCustomerAddresses } from '@/lib/addresses/address-book';
import { requirePermission } from '@/lib/auth/staff';
import { currentSeasonCatalog } from '@/lib/catalog/queries';
import { db } from '@/lib/db';
import { builderHref, type BuilderParams } from '@/lib/orders/builder-href';
import { addOnsFor, readAddOnOffers, readCart, readProductAvailability } from '@/lib/orders/cart';
import { openSeasonForCounter, posOwner } from '@/lib/pos/counter';
import { POS_PATH, posBuilderPath, posCheckoutPath } from '@/lib/pos/paths';

export const dynamic = 'force-dynamic';

/**
 * The counter's builder (R-059, R-031).
 *
 * This is the storefront's order builder — the same product panel, the same
 * cart, the same recipient picker — pointed at a different set of actions and a
 * different base path. Nothing about how an order is built is duplicated here,
 * which is the only way "the POS produces the same order as the website" stays
 * true after the next change to either (UR-006).
 */
export default async function PosBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<BuilderParams>;
}) {
  const [{ customerId }, query, staff] = await Promise.all([
    params,
    searchParams,
    requirePermission('orders.manage'),
  ]);

  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) notFound();

  const season = await openSeasonForCounter();
  if (!season.ok) {
    return (
      <div className="space-y-4">
        <BackLink href={POS_PATH}>Point of sale</BackLink>
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {season.publicMessage}
        </p>
      </div>
    );
  }

  const owner = posOwner(staff, customerId);
  const basePath = posBuilderPath(customerId);

  const [products, availability, cart, addresses, methods, pickupLocations, addOnOffers] =
    await Promise.all([
      currentSeasonCatalog(season.value.id),
      readProductAvailability(season.value.id),
      readCart(owner, season.value.id),
      listCustomerAddresses(customerId),
      db.fulfillmentMethod.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      db.pickupLocation.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      readAddOnOffers(season.value.id),
    ]);

  const items: BuilderProduct[] = products.map((product) => ({
    product,
    unitsLeft: availability.get(product.id) ?? null,
    addOns: addOnsFor(addOnOffers, product.id),
  }));

  const openLine = query.assign
    ? (cart?.lines.find((line) => line.id === query.assign) ?? null)
    : null;
  const editingAddress = query.editAddress
    ? (addresses.find((address) => address.id === query.editAddress) ?? null)
    : null;

  const assignmentOptions: AssignmentOptions = {
    methods,
    pickupLocations,
    addresses,
    selfName: customer.fullName,
  };

  const cartActions = {
    changeQuantity: changeQuantityAtCounter.bind(null, customerId),
    removeLine: removeLineAtCounter.bind(null, customerId),
    unassignLine: unassignLineAtCounter.bind(null, customerId),
  };

  return (
    <div className="space-y-6">
      <BackLink href={POS_PATH}>Point of sale</BackLink>

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{customer.fullName}</h1>
        <Badge tone="neutral">Counter order</Badge>
        <span className="text-sm text-[var(--color-ink-muted)]">{customer.email}</span>
        <Link
          href={`/admin/customers/${customer.id}`}
          className="text-sm underline underline-offset-4"
        >
          Their record
        </Link>
      </header>

      <FlashMessages notice={query.notice} problem={query.problem} testIdPrefix="builder" />

      {openLine && editingAddress ? (
        <SavedAddressEditor
          address={editingAddress}
          line={openLine}
          saveAddressAction={saveAddressAtCounter.bind(null, customerId)}
          cancelHref={builderHref(basePath, { assign: openLine.id })}
        />
      ) : null}

      {openLine && !editingAddress ? (
        query.add ? (
          <AddRecipientPanel
            line={openLine}
            options={assignmentOptions}
            links={linksFor(basePath, openLine.id)}
            assignAction={assignLineAtCounter.bind(null, customerId)}
          />
        ) : (
          <AssignmentPanel
            line={openLine}
            options={assignmentOptions}
            links={linksFor(basePath, openLine.id)}
            assignAction={assignLineAtCounter.bind(null, customerId)}
          />
        )
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <BuilderProductPanel
          items={items}
          addAction={addToCartAtCounter.bind(null, customerId)}
          quickViewHref={(slug) => `/collection/${slug}`}
        />

        <div className="space-y-4">
          <CartPanel
            cart={cart}
            actions={cartActions}
            assignHref={(lineId) => builderHref(basePath, { assign: lineId })}
            checkoutHref={posCheckoutPath(customerId)}
            className="lg:sticky lg:top-4"
            testId="pos-cart"
          />

          {cart ? (
            <form action={discardCounterCart.bind(null, customerId)}>
              <Button type="submit" variant="ghost" data-testid="pos-discard">
                Clear this cart
              </Button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function linksFor(basePath: string, lineId: string): AssignmentLinks {
  return {
    addRecipientHref: builderHref(basePath, { assign: lineId, add: '1' }),
    pickRecipientHref: builderHref(basePath, { assign: lineId }),
    editAddressHref: (addressId) => builderHref(basePath, { assign: lineId, editAddress: addressId }),
    closeHref: basePath,
  };
}
