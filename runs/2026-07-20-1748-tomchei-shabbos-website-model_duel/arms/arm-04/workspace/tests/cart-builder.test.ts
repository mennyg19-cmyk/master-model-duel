import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import {
  ASSIGNMENT_NOT_ALLOWED,
  INVALID_ASSIGNMENT,
  assignCartLine,
  unassignCartLine,
} from '../src/lib/orders/assignment';
import { addOnsFor, readAddOnOffers, readCart } from '../src/lib/orders/cart';
import {
  DRAFT_ALREADY_IN_PROGRESS,
  GUEST_DRAFT_NOT_FOUND,
  INVALID_CART_INPUT,
  NOT_ENOUGH_STOCK,
  PRODUCT_NOT_AVAILABLE,
  addProductToCart,
  claimGuestDraft,
  removeCartLine,
  setLineQuantity,
} from '../src/lib/orders/cart-service';
import { hashGuestToken, type DraftOwner } from '../src/lib/orders/draft-access';
import { findOwnedOrder } from '../src/lib/orders/draft-access';
import {
  ORDER_NOT_FOUND,
  UNASSIGNED_LINES,
  discardDraft,
  finalizeOrder,
} from '../src/lib/orders/order-service';
import { readOrderDetail } from '../src/lib/orders/customer-orders';
import { writeSetting } from '../src/lib/settings';
import {
  addProductOption,
  createAddOn,
  createCustomer,
  createFulfillmentMethod,
  createPickupLocation,
  createProduct,
  createSeason,
  db,
} from './fixtures';

/**
 * The builder is a form on a public page, so every test here posts what a browser
 * could post rather than what the page offered: another customer's address id, a
 * quantity above the shelf, an option that does not exist.
 */

after(() => db.$disconnect());

const DELIVERY_ZIP = '08701';
const OUT_OF_AREA_ZIP = '11219';

function customerOwner(customerId: string): DraftOwner {
  return { kind: 'customer', customerId };
}

function guestOwner(token: string): DraftOwner & { kind: 'guest' } {
  return { kind: 'guest', tokenHash: hashGuestToken(token) };
}

function newAddress(overrides: Partial<Record<string, string>> = {}) {
  return {
    recipientName: 'Rivka Cohen',
    label: '',
    line1: '12 Main Street',
    line2: '',
    city: 'Lakewood',
    state: 'NJ',
    postalCode: DELIVERY_ZIP,
    phone: '',
    ...overrides,
  };
}

test('items go into the cart with no recipient and no reservation', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const owner = customerOwner(customer.id);
  const product = await createProduct(season, { priceCents: 3600, onHand: 5 });

  const added = await addProductToCart(owner, season.id, {
    productId: product.id,
    quantity: '2',
    optionLabels: {},
    addOnIds: [],
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;

  const cart = await readCart(owner, season.id);
  assert.equal(cart?.lines.length, 1);
  assert.equal(cart?.itemCount, 2);
  assert.equal(cart?.subtotalCents, 7200);
  assert.equal(cart?.unassignedCount, 1);
  assert.equal(cart?.isReadyForCheckout, false);
  assert.equal(cart?.lines[0].assignment, null);

  const stock = await db.inventoryItem.findUniqueOrThrow({ where: { productId: product.id } });
  assert.equal(stock.reserved, 0, 'a draft holds nothing until checkout');
});

test('the shelf is the ceiling, counting what is already in the cart', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const owner = customerOwner(customer.id);
  const product = await createProduct(season, { onHand: 3 });

  const first = await addProductToCart(owner, season.id, {
    productId: product.id,
    quantity: '2',
    optionLabels: {},
    addOnIds: [],
  });
  assert.equal(first.ok, true);

  const tooMany = await addProductToCart(owner, season.id, {
    productId: product.id,
    quantity: '2',
    optionLabels: {},
    addOnIds: [],
  });
  assert.equal(tooMany.ok === false && tooMany.code, NOT_ENOUGH_STOCK);
  assert.match(tooMany.ok === false ? tooMany.publicMessage : '', /Only 1 more/);

  const lastOne = await addProductToCart(owner, season.id, {
    productId: product.id,
    quantity: '1',
    optionLabels: {},
    addOnIds: [],
  });
  assert.equal(lastOne.ok, true);
});

test('an option has to be one the product offers, and it prices the line', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const owner = customerOwner(customer.id);
  const product = await createProduct(season, { priceCents: 4000, onHand: 10 });
  await addProductOption(product, { groupLabel: 'Size', label: 'Standard' });
  await addProductOption(product, { groupLabel: 'Size', label: 'Large', priceAdjustmentCents: 1500 });

  const unanswered = await addProductToCart(owner, season.id, {
    productId: product.id,
    quantity: '1',
    optionLabels: {},
    addOnIds: [],
  });
  assert.equal(unanswered.ok === false && unanswered.code, INVALID_CART_INPUT);

  const invented = await addProductToCart(owner, season.id, {
    productId: product.id,
    quantity: '1',
    optionLabels: { Size: 'Enormous' },
    addOnIds: [],
  });
  assert.equal(invented.ok === false && invented.code, INVALID_CART_INPUT);

  const large = await addProductToCart(owner, season.id, {
    productId: product.id,
    quantity: '2',
    optionLabels: { Size: 'Large' },
    addOnIds: [],
  });
  assert.equal(large.ok, true);

  const cart = await readCart(owner, season.id);
  assert.equal(cart?.lines[0].unitPriceCents, 5500);
  assert.equal(cart?.lines[0].lineTotalCents, 11000);
  assert.deepEqual(cart?.lines[0].options, [
    { groupLabel: 'Size', label: 'Large', priceAdjustmentCents: 1500 },
  ]);
});

test('a restricted add-on is only offered, and only accepted, on its own product', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const owner = customerOwner(customer.id);
  const wineBox = await createProduct(season, { onHand: 5 });
  const cakeBox = await createProduct(season, { onHand: 5 });

  const anywhere = await createAddOn(season, { priceCents: 300 });
  const wineOnly = await createAddOn(season, {
    priceCents: 1800,
    restrictedToProductIds: [wineBox.id],
  });

  const offers = await readAddOnOffers(season.id);
  assert.deepEqual(
    addOnsFor(offers, cakeBox.id).map((addOn) => addOn.id),
    [anywhere.id],
  );
  assert.equal(addOnsFor(offers, wineBox.id).length, 2);

  const wrongProduct = await addProductToCart(owner, season.id, {
    productId: cakeBox.id,
    quantity: '1',
    optionLabels: {},
    addOnIds: [wineOnly.id],
  });
  assert.equal(wrongProduct.ok === false && wrongProduct.code, PRODUCT_NOT_AVAILABLE);

  const allowed = await addProductToCart(owner, season.id, {
    productId: wineBox.id,
    quantity: '2',
    optionLabels: {},
    addOnIds: [wineOnly.id, anywhere.id],
  });
  assert.equal(allowed.ok, true);

  const cart = await readCart(owner, season.id);
  assert.equal(cart?.lines[0].addOns.length, 2);
  // Add-ons ride along with the item: two boxes with a bottle each is two bottles.
  assert.equal(cart?.subtotalCents, (1000 + 1800 + 300) * 2);
});

test('quantity zero removes the line, and add-ons follow the quantity', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const owner = customerOwner(customer.id);
  const product = await createProduct(season, { priceCents: 1000, onHand: 10 });
  const addOn = await createAddOn(season, { priceCents: 500 });

  const added = await addProductToCart(owner, season.id, {
    productId: product.id,
    quantity: '1',
    optionLabels: {},
    addOnIds: [addOn.id],
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;

  const raised = await setLineQuantity(owner, { lineId: added.value.lineId, quantity: 3 });
  assert.equal(raised.ok && raised.value.removed, false);

  const afterRaise = await readCart(owner, season.id);
  assert.equal(afterRaise?.subtotalCents, 4500);

  const negative = await setLineQuantity(owner, { lineId: added.value.lineId, quantity: -1 });
  assert.equal(negative.ok === false && negative.code, INVALID_CART_INPUT);

  const zeroed = await setLineQuantity(owner, { lineId: added.value.lineId, quantity: 0 });
  assert.equal(zeroed.ok && zeroed.value.removed, true);
  assert.equal((await readCart(owner, season.id))?.lines.length, 0);
});

test('a line only answers to the cart that owns it', async () => {
  const season = await createSeason();
  const mine = await createCustomer();
  const theirs = await createCustomer();
  const product = await createProduct(season, { onHand: 5 });

  const added = await addProductToCart(customerOwner(mine.id), season.id, {
    productId: product.id,
    quantity: '1',
    optionLabels: {},
    addOnIds: [],
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;

  const stranger = customerOwner(theirs.id);
  const removal = await removeCartLine(stranger, added.value.lineId);
  assert.equal(removal.ok, false);

  const quantity = await setLineQuantity(stranger, { lineId: added.value.lineId, quantity: 5 });
  assert.equal(quantity.ok, false);

  const assignment = await assignCartLine(stranger, {
    lineId: added.value.lineId,
    target: 'self',
    fulfillmentMethodId: (await createFulfillmentMethod('PICKUP')).id,
  });
  assert.equal(assignment.ok === false && assignment.code, ASSIGNMENT_NOT_ALLOWED);

  // Nothing the stranger tried may have landed.
  assert.equal((await readCart(customerOwner(mine.id), season.id))?.lines.length, 1);
});

test('a draft is only discarded by the owner who built it', async () => {
  const season = await createSeason();
  const mine = await createCustomer();
  const theirs = await createCustomer();
  const product = await createProduct(season, { onHand: 5 });

  const added = await addProductToCart(customerOwner(mine.id), season.id, {
    productId: product.id,
    quantity: '1',
    optionLabels: {},
    addOnIds: [],
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;

  // The order id is the only thing the cancel form posts, so the service has to
  // be the thing that refuses it rather than the page that renders the button.
  const stranger = await discardDraft(customerOwner(theirs.id), added.value.orderId, null);
  assert.equal(stranger.ok === false && stranger.code, ORDER_NOT_FOUND);
  assert.equal((await readCart(customerOwner(mine.id), season.id))?.lines.length, 1);

  const own = await discardDraft(customerOwner(mine.id), added.value.orderId, null);
  assert.equal(own.ok, true);
  assert.equal(await readCart(customerOwner(mine.id), season.id), null);
});

test('the three-way picker: on the order, from the book, and somebody new', async () => {
  await writeSetting('shipping.deliveryZips', [DELIVERY_ZIP]);

  const season = await createSeason();
  const customer = await createCustomer('Yaakov Klein');
  const owner = customerOwner(customer.id);
  const product = await createProduct(season, { priceCents: 3600, onHand: 10 });
  const delivery = await createFulfillmentMethod('DELIVERY');
  const pickup = await db.fulfillmentMethod.update({
    where: { id: (await createFulfillmentMethod('PICKUP')).id },
    data: { requiresAddress: false, requiresPickupLocation: true },
  });
  const location = await createPickupLocation();

  const lines = [];
  for (let index = 0; index < 3; index += 1) {
    const added = await addProductToCart(owner, season.id, {
      productId: product.id,
      quantity: '1',
      optionLabels: {},
      addOnIds: [],
    });
    assert.equal(added.ok, true);
    if (added.ok) lines.push(added.value.lineId);
  }

  // 1. On the order: the name comes from the account, never from the form.
  const onOrder = await assignCartLine(owner, {
    lineId: lines[0],
    target: 'self',
    fulfillmentMethodId: pickup.id,
    pickupLocationId: location.id,
    recipientName: 'Somebody Else',
  });
  assert.equal(onOrder.ok && onOrder.value.recipientName, 'Yaakov Klein');

  // 2. Somebody new, which saves them to the address book on the way past.
  const newPerson = await assignCartLine(owner, {
    lineId: lines[1],
    target: 'new',
    fulfillmentMethodId: delivery.id,
    newAddress: newAddress(),
    greetingMessage: 'Good Shabbos',
  });
  assert.equal(newPerson.ok && newPerson.value.recipientName, 'Rivka Cohen');

  const book = await db.customerAddress.findMany({ where: { customerId: customer.id } });
  assert.equal(book.length, 1, 'a new recipient joins the address book exactly once');

  // 3. From the book, by id.
  const fromBook = await assignCartLine(owner, {
    lineId: lines[2],
    target: 'saved',
    fulfillmentMethodId: delivery.id,
    customerAddressId: book[0].id,
  });
  assert.equal(fromBook.ok && fromBook.value.savedAddressId, book[0].id);

  const cart = await readCart(owner, season.id);
  assert.equal(cart?.unassignedCount, 0);
  assert.equal(cart?.isReadyForCheckout, true);
  assert.equal(cart?.subtotalCents, 10800);
  assert.equal(cart?.lines[0].assignment?.pickupLocationName, location.name);
  assert.equal(cart?.lines[0].assignment?.addressSummary, null, 'a pickup has no street address');
  assert.equal(cart?.lines[1].assignment?.greetingMessage, 'Good Shabbos');
  assert.match(cart?.lines[2].assignment?.addressSummary ?? '', /12 Main Street/);
});

test('assignment refuses what the form should not have been able to say', async () => {
  await writeSetting('shipping.deliveryZips', [DELIVERY_ZIP]);

  const season = await createSeason();
  const customer = await createCustomer();
  const stranger = await createCustomer();
  const owner = customerOwner(customer.id);
  const product = await createProduct(season, { onHand: 10 });
  const delivery = await createFulfillmentMethod('DELIVERY');
  const pickupOnly = await db.fulfillmentMethod.update({
    where: { id: (await createFulfillmentMethod('PICKUP')).id },
    data: { requiresAddress: false, requiresPickupLocation: true },
  });

  const added = await addProductToCart(owner, season.id, {
    productId: product.id,
    quantity: '1',
    optionLabels: {},
    addOnIds: [],
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  const lineId = added.value.lineId;

  const strangersAddress = await db.customerAddress.create({
    data: {
      customerId: stranger.id,
      recipientName: 'Not Yours',
      line1: '9 Elsewhere Road',
      city: 'Lakewood',
      state: 'NJ',
      postalCode: DELIVERY_ZIP,
      addressKey: `stranger-${Date.now()}`,
    },
  });

  const borrowed = await assignCartLine(owner, {
    lineId,
    target: 'saved',
    fulfillmentMethodId: delivery.id,
    customerAddressId: strangersAddress.id,
  });
  assert.equal(borrowed.ok === false && borrowed.code, ASSIGNMENT_NOT_ALLOWED);

  const noAddress = await assignCartLine(owner, {
    lineId,
    target: 'new',
    fulfillmentMethodId: delivery.id,
    newAddress: newAddress({ line1: '' }),
  });
  assert.equal(noAddress.ok, false);

  const outOfArea = await assignCartLine(owner, {
    lineId,
    target: 'new',
    fulfillmentMethodId: delivery.id,
    newAddress: newAddress({ postalCode: OUT_OF_AREA_ZIP }),
  });
  assert.equal(outOfArea.ok === false && outOfArea.code, INVALID_ASSIGNMENT);
  assert.match(outOfArea.ok === false ? outOfArea.publicMessage : '', /Volunteers do not drive/);

  const noPickupLocation = await assignCartLine(owner, {
    lineId,
    target: 'self',
    fulfillmentMethodId: pickupOnly.id,
  });
  assert.equal(noPickupLocation.ok === false && noPickupLocation.code, INVALID_ASSIGNMENT);

  const retiredMethod = await createFulfillmentMethod('SHIPPING');
  await db.fulfillmentMethod.update({ where: { id: retiredMethod.id }, data: { isActive: false } });
  const withdrawn = await assignCartLine(owner, {
    lineId,
    target: 'new',
    fulfillmentMethodId: retiredMethod.id,
    newAddress: newAddress(),
  });
  assert.equal(withdrawn.ok === false && withdrawn.code, INVALID_ASSIGNMENT);

  // Nothing above may have half-assigned the line.
  const line = await db.orderLine.findUniqueOrThrow({ where: { id: lineId } });
  assert.equal(line.recipientName, null);
  assert.equal(line.fulfillmentMethodId, null);
});

test('clearing a recipient keeps the item, and the database refuses half an assignment', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const owner = customerOwner(customer.id);
  const product = await createProduct(season, { onHand: 10 });
  const pickup = await db.fulfillmentMethod.update({
    where: { id: (await createFulfillmentMethod('PICKUP')).id },
    data: { requiresAddress: false },
  });

  const added = await addProductToCart(owner, season.id, {
    productId: product.id,
    quantity: '1',
    optionLabels: {},
    addOnIds: [],
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;

  const assigned = await assignCartLine(owner, {
    lineId: added.value.lineId,
    target: 'self',
    fulfillmentMethodId: pickup.id,
  });
  assert.equal(assigned.ok, true);

  const cleared = await unassignCartLine(owner, added.value.lineId);
  assert.equal(cleared.ok, true);

  const cart = await readCart(owner, season.id);
  assert.equal(cart?.lines.length, 1, 'clearing a recipient is not deleting the item');
  assert.equal(cart?.unassignedCount, 1);

  await assert.rejects(
    db.orderLine.update({
      where: { id: added.value.lineId },
      data: { recipientName: 'Half Assigned' },
    }),
    /OrderLine_assignment_complete|violates check constraint/,
  );
});

test('checkout refuses an order that still has a line without a recipient', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const owner = customerOwner(customer.id);
  const product = await createProduct(season, { onHand: 10 });
  const pickup = await db.fulfillmentMethod.update({
    where: { id: (await createFulfillmentMethod('PICKUP')).id },
    data: { requiresAddress: false },
  });

  const assignedLine = await addProductToCart(owner, season.id, {
    productId: product.id,
    quantity: '1',
    optionLabels: {},
    addOnIds: [],
  });
  const strayLine = await addProductToCart(owner, season.id, {
    productId: product.id,
    quantity: '1',
    optionLabels: {},
    addOnIds: [],
  });
  assert.equal(assignedLine.ok && strayLine.ok, true);
  if (!assignedLine.ok || !strayLine.ok) return;

  await assignCartLine(owner, {
    lineId: assignedLine.value.lineId,
    target: 'self',
    fulfillmentMethodId: pickup.id,
  });

  const refused = await finalizeOrder(assignedLine.value.orderId, null);
  assert.equal(refused.ok === false && refused.code, UNASSIGNED_LINES);

  await removeCartLine(owner, strayLine.value.lineId);
  const accepted = await finalizeOrder(assignedLine.value.orderId, null);
  assert.equal(accepted.ok, true);
});

test('a guest cart is reachable only with its own token', async () => {
  const season = await createSeason();
  const product = await createProduct(season, { onHand: 10 });
  // A token is unique per cart in the database, so the tokens are unique per run.
  const token = `guest-token-${Date.now()}`;
  const guest = guestOwner(token);
  const otherGuest = guestOwner(`other-${token}`);

  const added = await addProductToCart(guest, season.id, {
    productId: product.id,
    quantity: '1',
    optionLabels: {},
    addOnIds: [],
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;

  assert.equal((await readCart(guest, season.id))?.lines.length, 1);
  assert.equal(await readCart(otherGuest, season.id), null, 'another token is another cart');

  const order = await db.order.findUniqueOrThrow({ where: { id: added.value.orderId } });
  assert.equal(order.customerId, null);
  assert.notEqual(order.guestTokenHash, token, 'the token is stored hashed');

  // Knowing the order id is not enough for anybody: not another guest, and not
  // a signed-in customer (R-121).
  const customer = await createCustomer();
  assert.equal(await findOwnedOrder(otherGuest, order.id), null);
  assert.equal(await findOwnedOrder(customerOwner(customer.id), order.id), null);
  assert.equal(await readOrderDetail(customerOwner(customer.id), order.id), null);
});

test('signing in claims the guest cart, and a failed claim leaves it alone', async () => {
  const season = await createSeason();
  const product = await createProduct(season, { onHand: 10 });
  const guest = guestOwner(`guest-${Date.now()}`);
  const customer = await createCustomer();

  const added = await addProductToCart(guest, season.id, {
    productId: product.id,
    quantity: '1',
    optionLabels: {},
    addOnIds: [],
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;

  const claimed = await claimGuestDraft(customer.id, guest, season.id);
  assert.equal(claimed.ok, true);
  assert.equal(claimed.ok && claimed.value.guestTokenHash, null);
  assert.equal((await readCart(customerOwner(customer.id), season.id))?.lines.length, 1);
  assert.equal(await readCart(guest, season.id), null);

  const audit = await db.auditEvent.findFirst({
    where: { action: 'order.draft_claimed', entityId: added.value.orderId },
  });
  assert.equal(audit?.actorLabel, 'system');

  // A second guest cart cannot be claimed on top of the order the account is now
  // building: the guest cart stays where it is.
  const secondGuest = guestOwner(`guest-again-${Date.now()}`);
  const alsoAdded = await addProductToCart(secondGuest, season.id, {
    productId: product.id,
    quantity: '1',
    optionLabels: {},
    addOnIds: [],
  });
  assert.equal(alsoAdded.ok, true);

  const refused = await claimGuestDraft(customer.id, secondGuest, season.id);
  assert.equal(refused.ok === false && refused.code, DRAFT_ALREADY_IN_PROGRESS);
  assert.equal((await readCart(secondGuest, season.id))?.lines.length, 1);

  const nothingToClaim = await claimGuestDraft(customer.id, guestOwner('never-used'), season.id);
  assert.equal(nothingToClaim.ok === false && nothingToClaim.code, GUEST_DRAFT_NOT_FOUND);
});
