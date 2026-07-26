import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import {
  ADDRESS_NOT_FOUND,
  DUPLICATE_ADDRESS,
  INVALID_ADDRESS,
  archiveCustomerAddress,
  findCustomerAddress,
  listCustomerAddresses,
  saveCustomerAddress,
} from '../src/lib/addresses/address-book';
import { addressSummary } from '../src/lib/addresses/address-summary';
import { updateCustomerProfile } from '../src/lib/customers';
import { addProductToCart } from '../src/lib/orders/cart-service';
import { assignCartLine } from '../src/lib/orders/assignment';
import { finalizeOrder } from '../src/lib/orders/order-service';
import { writeSetting } from '../src/lib/settings';
import {
  createCustomer,
  createFulfillmentMethod,
  createProduct,
  createSeason,
  createStaffContext,
  db,
} from './fixtures';

after(() => db.$disconnect());

const DELIVERY_ZIP = '08701';

function address(overrides: Record<string, string> = {}) {
  return {
    recipientName: 'Rivka Cohen',
    label: '',
    line1: '12 Main Street',
    line2: '',
    city: 'Lakewood',
    state: 'nj',
    postalCode: `${DELIVERY_ZIP}-1234`,
    phone: '(555) 010-0100',
    ...overrides,
  };
}

test('an address is normalized on the way in', async () => {
  const customer = await createCustomer();

  const saved = await saveCustomerAddress({ ...address(), customerId: customer.id });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;

  assert.equal(saved.value.created, true);
  assert.equal(saved.value.address.state, 'NJ', 'the state code is upper-cased');
  assert.equal(saved.value.address.postalCode, DELIVERY_ZIP, 'ZIP+4 is stored as five digits');
  assert.equal(saved.value.address.phone, '+15550100100', 'the phone is stored dialable');
  assert.equal(saved.value.address.label, null, 'a blank nickname is null, not ""');
  assert.equal(
    addressSummary(saved.value.address),
    '12 Main Street, Lakewood, NJ 08701',
  );
});

test('the same place typed differently lands on the row that is already there', async () => {
  const customer = await createCustomer();

  const first = await saveCustomerAddress({ ...address(), customerId: customer.id });
  const second = await saveCustomerAddress({
    ...address({ line1: '12 main st.', city: 'lakewood', label: 'Mom' }),
    customerId: customer.id,
  });

  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;

  assert.equal(second.value.address.id, first.value.address.id);
  assert.equal(second.value.created, false);
  assert.equal(second.value.address.label, 'Mom', 'the newer details win on the shared row');
  assert.equal((await listCustomerAddresses(customer.id)).length, 1);
});

test('an edit that collides with another saved address is refused rather than merged', async () => {
  const customer = await createCustomer();

  const home = await saveCustomerAddress({ ...address(), customerId: customer.id });
  const office = await saveCustomerAddress({
    ...address({ recipientName: 'Rivka at work', line1: '900 Cedar Bridge Avenue' }),
    customerId: customer.id,
  });
  assert.equal(home.ok && office.ok, true);
  if (!home.ok || !office.ok) return;

  const collision = await saveCustomerAddress({
    ...address({ line1: '900 cedar bridge ave' }),
    customerId: customer.id,
    addressId: home.value.address.id,
  });

  assert.equal(collision.ok === false && collision.code, DUPLICATE_ADDRESS);
  assert.equal((await listCustomerAddresses(customer.id)).length, 2);
});

test('coordinates come from the geocode cache and nowhere else', async () => {
  const customer = await createCustomer();

  // The cache is keyed by the address itself and outlives one test run, so this
  // street is one nobody has looked up rather than one nobody looked up yet.
  const line1 = `${Date.now()} Unlooked Up Lane`;

  const withoutCache = await saveCustomerAddress({
    ...address({ line1 }),
    customerId: customer.id,
  });
  assert.equal(withoutCache.ok && withoutCache.value.address.latitude, null);
  assert.equal(withoutCache.ok && withoutCache.value.address.geocodedAt, null);
  if (!withoutCache.ok) return;

  await db.geocodeCache.create({
    data: {
      addressKey: withoutCache.value.address.addressKey,
      outcome: 'FOUND',
      latitude: 40.0959,
      longitude: -74.2176,
      provider: 'test',
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

  const again = await saveCustomerAddress({
    ...address({ line1, label: 'Cached' }),
    customerId: customer.id,
  });
  assert.equal(again.ok && again.value.address.latitude, 40.0959);
  assert.notEqual(again.ok && again.value.address.geocodedAt, null);
});

test('validation refuses what the packing floor could not use', async () => {
  const customer = await createCustomer();

  const noStreet = await saveCustomerAddress({ ...address({ line1: '  ' }), customerId: customer.id });
  assert.equal(noStreet.ok === false && noStreet.code, INVALID_ADDRESS);

  const badState = await saveCustomerAddress({
    ...address({ state: 'New Jersey' }),
    customerId: customer.id,
  });
  assert.equal(badState.ok === false && badState.code, INVALID_ADDRESS);

  const badZip = await saveCustomerAddress({
    ...address({ postalCode: '871' }),
    customerId: customer.id,
  });
  assert.equal(badZip.ok === false && badZip.code, INVALID_ADDRESS);

  const badPhone = await saveCustomerAddress({
    ...address({ phone: '555-01' }),
    customerId: customer.id,
  });
  assert.equal(badPhone.ok === false && badPhone.code, INVALID_ADDRESS);
});

test('one customer cannot read or write another customer\'s book', async () => {
  const mine = await createCustomer();
  const theirs = await createCustomer();

  const saved = await saveCustomerAddress({ ...address(), customerId: theirs.id });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;

  assert.equal(await findCustomerAddress(mine.id, saved.value.address.id), null);

  const stolenEdit = await saveCustomerAddress({
    ...address({ line1: '1 Hijack Road' }),
    customerId: mine.id,
    addressId: saved.value.address.id,
  });
  assert.equal(stolenEdit.ok === false && stolenEdit.code, ADDRESS_NOT_FOUND);

  const stolenArchive = await archiveCustomerAddress({
    customerId: mine.id,
    addressId: saved.value.address.id,
  });
  assert.equal(stolenArchive.ok === false && stolenArchive.code, ADDRESS_NOT_FOUND);

  const untouched = await db.customerAddress.findUniqueOrThrow({
    where: { id: saved.value.address.id },
  });
  assert.equal(untouched.line1, '12 Main Street');
  assert.equal(untouched.isArchived, false);
});

test('editing a saved address follows the draft but never a placed order', async () => {
  await writeSetting('shipping.deliveryZips', [DELIVERY_ZIP]);

  const season = await createSeason();
  const customer = await createCustomer();
  const owner = { kind: 'customer', customerId: customer.id } as const;
  const product = await createProduct(season, { onHand: 10 });
  const delivery = await createFulfillmentMethod('DELIVERY');

  const placedLine = await addProductToCart(owner, season.id, {
    productId: product.id,
    quantity: '1',
    optionLabels: {},
    addOnIds: [],
  });
  assert.equal(placedLine.ok, true);
  if (!placedLine.ok) return;

  const assigned = await assignCartLine(owner, {
    lineId: placedLine.value.lineId,
    target: 'new',
    fulfillmentMethodId: delivery.id,
    newAddress: address({ phone: '' }),
  });
  assert.equal(assigned.ok, true);
  if (!assigned.ok || !assigned.value.savedAddressId) return;
  const addressId = assigned.value.savedAddressId;

  const placed = await finalizeOrder(placedLine.value.orderId, null);
  assert.equal(placed.ok, true);

  // A second order, still a draft, pointing at the same saved address.
  const draftLine = await addProductToCart(owner, season.id, {
    productId: product.id,
    quantity: '1',
    optionLabels: {},
    addOnIds: [],
  });
  assert.equal(draftLine.ok, true);
  if (!draftLine.ok) return;

  await assignCartLine(owner, {
    lineId: draftLine.value.lineId,
    target: 'saved',
    fulfillmentMethodId: delivery.id,
    customerAddressId: addressId,
  });

  const corrected = await saveCustomerAddress({
    ...address({ line1: '12 Main Street', line2: 'Apt 4', phone: '' }),
    customerId: customer.id,
    addressId,
  });
  assert.equal(corrected.ok, true);

  const draftRow = await db.orderLine.findUniqueOrThrow({ where: { id: draftLine.value.lineId } });
  assert.equal(draftRow.addressLine2, 'Apt 4', 'the draft follows the corrected address');

  const placedRow = await db.orderLine.findUniqueOrThrow({ where: { id: placedLine.value.lineId } });
  assert.equal(placedRow.addressLine2, null, 'a placed order keeps the snapshot it was placed on');
});

test('an address on a draft cannot be removed until those items move', async () => {
  await writeSetting('shipping.deliveryZips', [DELIVERY_ZIP]);

  const season = await createSeason();
  const customer = await createCustomer();
  const owner = { kind: 'customer', customerId: customer.id } as const;
  const product = await createProduct(season, { onHand: 10 });
  const delivery = await createFulfillmentMethod('DELIVERY');

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
    target: 'new',
    fulfillmentMethodId: delivery.id,
    newAddress: address({ phone: '' }),
  });
  assert.equal(assigned.ok, true);
  if (!assigned.ok || !assigned.value.savedAddressId) return;

  const inUse = await archiveCustomerAddress({
    customerId: customer.id,
    addressId: assigned.value.savedAddressId,
  });
  assert.equal(inUse.ok === false && inUse.code, INVALID_ADDRESS);

  await db.orderLine.delete({ where: { id: added.value.lineId } });

  const archived = await archiveCustomerAddress({
    customerId: customer.id,
    addressId: assigned.value.savedAddressId,
  });
  assert.equal(archived.ok, true);
  assert.equal((await listCustomerAddresses(customer.id)).length, 0, 'archived rows leave the book');
  assert.notEqual(
    await db.customerAddress.findUnique({ where: { id: assigned.value.savedAddressId } }),
    null,
    'archived, never deleted: past orders point at the row',
  );
});

test('a staff edit names the staff member; the customer\'s own edit is system', async () => {
  const customer = await createCustomer();
  const staff = await createStaffContext();

  const byCustomer = await saveCustomerAddress({ ...address(), customerId: customer.id });
  assert.equal(byCustomer.ok, true);
  if (!byCustomer.ok) return;

  const byStaff = await saveCustomerAddress(
    { ...address({ line1: '12 Main Street', line2: 'Rear house' }), customerId: customer.id, addressId: byCustomer.value.address.id },
    staff,
  );
  assert.equal(byStaff.ok, true);

  const rows = await db.auditEvent.findMany({
    where: { action: 'customer.address_saved', entityId: byCustomer.value.address.id },
    orderBy: { createdAt: 'asc' },
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].actorLabel, 'system');
  assert.equal(rows[0].actorStaffUserId, null);
  assert.equal(rows[1].actorStaffUserId, staff.actor.id);
  assert.match(rows[1].actorLabel, /Test Staff/);

  const archivedByStaff = await archiveCustomerAddress(
    { customerId: customer.id, addressId: byCustomer.value.address.id },
    staff,
  );
  assert.equal(archivedByStaff.ok, true);

  const archiveRow = await db.auditEvent.findFirstOrThrow({
    where: { action: 'customer.address_archived', entityId: byCustomer.value.address.id },
  });
  assert.equal(archiveRow.actorStaffUserId, staff.actor.id);
});

test('a profile edit writes the customer it was given, and phones stay unique', async () => {
  const customer = await createCustomer('Before Rename');
  const other = await createCustomer();

  // A phone number is unique across customers and survives the run that wrote
  // it, so this one belongs to this run.
  const digits = String(Date.now()).slice(-7);
  const local = `555${digits}`;

  const renamed = await updateCustomerProfile(customer, {
    fullName: 'After Rename',
    phone: `(555) ${digits.slice(0, 3)}-${digits.slice(3)}`,
  });
  assert.equal(renamed.ok && renamed.value.fullName, 'After Rename');
  assert.equal(renamed.ok && renamed.value.normalizedPhone, `+1${local}`);

  const blanked = await updateCustomerProfile(customer, { fullName: 'After Rename', phone: '' });
  assert.equal(blanked.ok && blanked.value.phone, null);

  const nameless = await updateCustomerProfile(customer, { fullName: '  ', phone: '' });
  assert.equal(nameless.ok, false);

  await updateCustomerProfile(customer, { fullName: 'After Rename', phone: local });
  const collision = await updateCustomerProfile(other, {
    fullName: 'Other Person',
    phone: `555 ${digits.slice(0, 3)} ${digits.slice(3)}`,
  });
  assert.equal(collision.ok, false);
  assert.match(collision.ok === false ? collision.publicMessage : '', /already on another account/);

  const audits = await db.auditEvent.count({
    where: { action: 'customer.profile_updated', entityId: customer.id },
  });
  assert.equal(audits >= 1, true);
});
