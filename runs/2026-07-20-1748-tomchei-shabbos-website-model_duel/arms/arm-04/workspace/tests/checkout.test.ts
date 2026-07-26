import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { saveCustomerAddress } from '../src/lib/addresses/address-book';
import { readCheckoutSummary } from '../src/lib/checkout/checkout-summary';
import { startCheckout } from '../src/lib/checkout/checkout-service';
import { resolveFulfillmentFees, type FeeSubject } from '../src/lib/checkout/fees';
import {
  setDefaultGreeting,
  setRecipientDeliveryDay,
  setRecipientGreeting,
} from '../src/lib/checkout/greetings';
import { findCheckoutConflicts } from '../src/lib/checkout/validation';
import type { DraftOwner } from '../src/lib/orders/draft-access';
import { writeSetting } from '../src/lib/settings';
import {
  createCustomer,
  createFulfillmentMethod,
  createDraftOrder,
  createProduct,
  createSeason,
  db,
} from './fixtures';

/**
 * Checkout is where a cart becomes money, so these tests are about the two
 * things that must never drift: what the customer is told a box costs, and
 * whether the catalogue still agrees with the cart it is being charged from.
 */

after(() => db.$disconnect());

const DELIVERY_DAYS = ['Sunday 12 Adar', 'Monday 13 Adar'];

const NO_RULES = { shippingBaseRateCents: 0, freeShippingThresholdCents: 0 };

function customerOwner(customerId: string): DraftOwner {
  return { kind: 'customer', customerId };
}

function subject(key: string, method: FeeSubject['method'], destinationKey: string): FeeSubject {
  return { key, method, destinationKey };
}

const perPackageDelivery = {
  id: 'method-per-package',
  label: 'Volunteer delivery',
  kind: 'DELIVERY' as const,
  feeBasis: 'PER_PACKAGE' as const,
  baseFeeCents: 500,
};

const bulkDelivery = {
  id: 'method-bulk',
  label: 'Bulk delivery',
  kind: 'DELIVERY' as const,
  feeBasis: 'PER_DESTINATION' as const,
  baseFeeCents: 800,
};

test('per-package delivery bills every recipient, bulk bills every destination', () => {
  const perPackage = resolveFulfillmentFees(
    [
      subject('a', perPackageDelivery, 'forest-ave'),
      subject('b', perPackageDelivery, 'yeshiva-lane'),
      subject('c', perPackageDelivery, 'cedar-bridge'),
    ],
    NO_RULES,
    10_000,
  );
  assert.equal(perPackage.totalCents, 1500, 'three recipients, three drives');

  const bulk = resolveFulfillmentFees(
    [
      subject('a', bulkDelivery, 'forest-ave'),
      subject('b', bulkDelivery, 'forest-ave'),
      subject('c', bulkDelivery, 'yeshiva-lane'),
    ],
    NO_RULES,
    10_000,
  );
  assert.equal(bulk.totalCents, 1600, 'three boxes to two doors is two stops');
  assert.equal(bulk.lines[1].feeCents, 0);
  assert.match(bulk.lines[1].explanation, /already billed/);
});

test('pickup is free and shipping follows the settings rate rules', () => {
  const pickup = {
    id: 'pickup',
    label: 'Pick up',
    kind: 'PICKUP' as const,
    feeBasis: 'NONE' as const,
    baseFeeCents: 900,
  };
  const shipping = {
    id: 'ship',
    label: 'Shipping',
    kind: 'SHIPPING' as const,
    feeBasis: 'PER_PACKAGE' as const,
    baseFeeCents: 100,
  };

  assert.equal(
    resolveFulfillmentFees([subject('a', pickup, 'counter')], NO_RULES, 10_000).totalCents,
    0,
    'a base fee on a no-charge method is still not charged',
  );

  const rules = { shippingBaseRateCents: 1200, freeShippingThresholdCents: 15_000 };
  assert.equal(
    resolveFulfillmentFees([subject('a', shipping, 'zip')], rules, 10_000).totalCents,
    1200,
    'the administrator rate wins over the method default',
  );
  assert.equal(
    resolveFulfillmentFees([subject('a', shipping, 'zip')], rules, 15_000).totalCents,
    0,
    'over the threshold, shipping is free',
  );
});

test('the quote a customer sees is the amount the order is placed at, frozen per box', async () => {
  // No day choices open, so delivery does not ask for one and the total is the
  // only thing under test here.
  await writeSetting('delivery.dayChoices', []);

  const season = await createSeason();
  const customer = await createCustomer();
  const owner = customerOwner(customer.id);
  const product = await createProduct(season, { priceCents: 3600 });
  const bulk = await createFulfillmentMethod('DELIVERY', 800, 'PER_DESTINATION');

  await createDraftOrder({
    season,
    customer,
    lines: [
      { product, fulfillmentMethodId: bulk.id, recipientName: 'Miriam Klein', addressLine1: '412 Forest Avenue' },
      { product, fulfillmentMethodId: bulk.id, recipientName: 'Rabbi Stein', addressLine1: '412 Forest Avenue' },
      { product, fulfillmentMethodId: bulk.id, recipientName: 'Tzvi Newman', addressLine1: '88 Yeshiva Lane' },
    ],
  });

  const summary = await readCheckoutSummary(owner, season.id);
  assert.equal(summary?.recipients.length, 3);
  assert.equal(summary?.itemsCents, 10_800);
  assert.equal(summary?.fulfillmentFeeCents, 1600, 'two doors, two fees');
  assert.equal(summary?.totalCents, 12_400);

  const paid = await startCheckout(owner, season.id, {
    expectedTotalCents: 12_400,
    contact: null,
  });
  assert.equal(paid.ok, true);

  const order = await db.order.findFirstOrThrow({ where: { customerId: customer.id } });
  assert.equal(order.status, 'PLACED');
  assert.equal(order.fulfillmentFeeCents, 1600);
  assert.equal(order.totalCents, 12_400);

  const packages = await db.package.findMany({ where: { orderId: order.id } });
  assert.equal(packages.length, 3);
  assert.equal(
    packages.reduce((total, row) => total + row.fulfillmentFeeCents, 0),
    1600,
    'the fee is snapshotted onto the boxes it was charged for',
  );
});

test('a total that does not match the page is refused, and nothing is placed', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const owner = customerOwner(customer.id);
  const product = await createProduct(season, { priceCents: 3600 });
  const pickup = await createFulfillmentMethod('PICKUP', 0, 'NONE');

  await createDraftOrder({ season, customer, lines: [{ product, fulfillmentMethodId: pickup.id }] });

  const tampered = await startCheckout(owner, season.id, {
    expectedTotalCents: 100,
    contact: null,
  });

  assert.equal(tampered.ok, false);
  if (tampered.ok) return;
  assert.match(tampered.publicMessage, /total changed/i);

  const order = await db.order.findFirstOrThrow({ where: { customerId: customer.id } });
  assert.equal(order.status, 'DRAFT', 'a refused checkout leaves the cart alone');
  assert.equal(order.orderNumber, null, 'and burns no order number');
});

test('checkout reports a re-price and a sold-out shelf, and refuses to charge', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const owner = customerOwner(customer.id);
  const product = await createProduct(season, { priceCents: 3600, onHand: 5 });
  const pickup = await createFulfillmentMethod('PICKUP', 0, 'NONE');

  const order = await createDraftOrder({
    season,
    customer,
    lines: [{ product, fulfillmentMethodId: pickup.id, quantity: 4 }],
  });

  await db.product.update({ where: { id: product.id }, data: { priceCents: 4200 } });
  await db.inventoryItem.update({ where: { productId: product.id }, data: { onHand: 2 } });

  const conflicts = await findCheckoutConflicts(order.id);
  assert.deepEqual(
    conflicts.map((conflict) => conflict.kind).sort(),
    ['price', 'stock'],
    'both the new price and the short shelf are reported',
  );

  const summary = await readCheckoutSummary(owner, season.id);
  assert.equal(summary?.isPayable, false);

  const blocked = await startCheckout(owner, season.id, {
    expectedTotalCents: summary?.totalCents ?? 0,
    contact: null,
  });
  assert.equal(blocked.ok, false);
});

test('a product taken off sale is a conflict, not a silent removal', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const product = await createProduct(season, { priceCents: 1000 });
  const pickup = await createFulfillmentMethod('PICKUP', 0, 'NONE');

  const order = await createDraftOrder({
    season,
    customer,
    lines: [{ product, fulfillmentMethodId: pickup.id }],
  });

  await db.product.update({ where: { id: product.id }, data: { isActive: false } });

  const conflicts = await findCheckoutConflicts(order.id);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'unavailable');
});

test('the order default fills empty cards and leaves overrides alone', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const owner = customerOwner(customer.id);
  const product = await createProduct(season);
  const pickup = await createFulfillmentMethod('PICKUP', 0, 'NONE');

  const order = await createDraftOrder({
    season,
    customer,
    lines: [
      { product, fulfillmentMethodId: pickup.id, recipientName: 'Miriam Klein', greetingMessage: null },
      { product, fulfillmentMethodId: pickup.id, recipientName: 'Rabbi Stein', greetingMessage: 'Just for the Rov' },
    ],
  });

  const saved = await setDefaultGreeting(owner, order.id, 'Freilichen Purim');
  assert.equal(saved.ok, true);

  const lines = await db.orderLine.findMany({ where: { orderId: order.id }, orderBy: { recipientName: 'asc' } });
  assert.equal(lines[0].greetingMessage, 'Freilichen Purim');
  assert.equal(lines[1].greetingMessage, 'Just for the Rov');

  const updated = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(updated.defaultGreeting, 'Freilichen Purim');
});

test("a recipient's card is saved on their address for next season", async () => {
  await writeSetting('delivery.dayChoices', []);

  const season = await createSeason();
  const customer = await createCustomer();
  const owner = customerOwner(customer.id);
  const product = await createProduct(season);
  const delivery = await createFulfillmentMethod('DELIVERY', 500);

  const address = await saveCustomerAddress({
    customerId: customer.id,
    addressId: null,
    recipientName: 'Miriam Klein',
    label: '',
    line1: '412 Forest Avenue',
    line2: '',
    city: 'Lakewood',
    state: 'NJ',
    postalCode: '08701',
    phone: '',
  });
  assert.equal(address.ok, true);
  if (!address.ok) return;

  const order = await createDraftOrder({
    season,
    customer,
    lines: [
      {
        product,
        fulfillmentMethodId: delivery.id,
        recipientName: 'Miriam Klein',
        greetingMessage: null,
        addressLine1: '412 Forest Avenue',
        customerAddressId: address.value.address.id,
      },
    ],
  });

  const summary = await readCheckoutSummary(owner, season.id);
  const recipientKey = summary?.recipients[0].key ?? '';

  const written = await setRecipientGreeting(owner, order.id, recipientKey, 'From all of us');
  assert.equal(written.ok, true);

  const remembered = await db.customerAddress.findUniqueOrThrow({ where: { id: address.value.address.id } });
  assert.equal(remembered.lastGreeting, 'From all of us');

  const nextTime = await readCheckoutSummary(owner, season.id);
  assert.equal(nextTime?.recipients[0].suggestedGreeting, 'From all of us');
});

test('a delivery day has to be one the manager opened, and is required before paying', async () => {
  await writeSetting('delivery.dayChoices', DELIVERY_DAYS);

  const season = await createSeason();
  const customer = await createCustomer();
  const owner = customerOwner(customer.id);
  const product = await createProduct(season, { priceCents: 2000 });
  const delivery = await createFulfillmentMethod('DELIVERY', 500);

  const order = await createDraftOrder({
    season,
    customer,
    lines: [{ product, fulfillmentMethodId: delivery.id, recipientName: 'Miriam Klein' }],
  });

  const before = await readCheckoutSummary(owner, season.id);
  assert.equal(before?.recipients[0].needsDeliveryDay, true);
  assert.equal(before?.isPayable, false, 'no day chosen yet');

  const key = before?.recipients[0].key ?? '';
  const invented = await setRecipientDeliveryDay(owner, order.id, key, 'Whenever', DELIVERY_DAYS);
  assert.equal(invented.ok, false, 'the drivers calendar is not a free-text field');

  const chosen = await setRecipientDeliveryDay(owner, order.id, key, DELIVERY_DAYS[0], DELIVERY_DAYS);
  assert.equal(chosen.ok, true);

  const after = await readCheckoutSummary(owner, season.id);
  assert.equal(after?.recipients[0].deliveryDay, DELIVERY_DAYS[0]);
  assert.equal(after?.isPayable, true);

  await writeSetting('delivery.dayChoices', []);
});

test('an order with a line nobody is receiving cannot be paid for', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const owner = customerOwner(customer.id);
  const product = await createProduct(season);
  const pickup = await createFulfillmentMethod('PICKUP', 0, 'NONE');

  const order = await createDraftOrder({
    season,
    customer,
    lines: [{ product, fulfillmentMethodId: pickup.id }],
  });

  await db.orderLine.updateMany({
    where: { orderId: order.id },
    data: { recipientName: null, fulfillmentMethodId: null },
  });

  const summary = await readCheckoutSummary(owner, season.id);
  assert.equal(summary?.unassignedCount, 1);
  assert.equal(summary?.isPayable, false);

  const refused = await startCheckout(owner, season.id, { expectedTotalCents: 0, contact: null });
  assert.equal(refused.ok, false);
});
