import { PrismaClient } from '@prisma/client';

import { DATABASE_URL, TEST_DATABASE_URL } from './db-server';
import { parseForms, Session } from './http-form';
import { envWithoutDatabaseUrl, runCommand, runTests, SmokeRun } from './smoke-harness';
import {
  builderCards,
  cartLines,
  centsOf,
  countOccurrences,
  countOf,
  dollars,
  formWith,
  noticeOf,
  redirectOf,
  referenceOf,
} from './smoke-p4-helpers';

/**
 * Phase P4 smoke run: the cart-first builder, the address book and the customer
 * account, driven the way a customer drives them — pages fetched over HTTP and
 * server actions replayed from the HTML that rendered them.
 *
 * Expects `npm run dev` up on 3104 against the seeded database.
 */
const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3104';

const DONOR = { email: 'donor@example.com', fullName: 'Sara Donor' };
const FRIEND = { email: 'friend@example.com', fullName: 'Chaim Friend' };
const MANAGER_EMAIL = 'manager@tomchei.example';
const DRIVER_EMAIL = 'driver@tomchei.example';

const GUEST_COOKIE = 'tsm_guest_draft';

/** In the seeded delivery area (08701, 08753, 10952) and well outside it. */
const NEW_RECIPIENT = {
  recipientName: 'Tzvi Newman',
  line1: '17 Cedar Bridge Ave',
  line2: 'Suite 4',
  city: 'Toms River',
  state: 'NJ',
  postalCode: '08753',
  phone: '(555) 010-7788',
};

const TEST_FILES = ['tests/cart-builder.test.ts', 'tests/address-book.test.ts'];

const db = new PrismaClient({ datasourceUrl: DATABASE_URL });

const run = new SmokeRun('P4', [
  `Run at ${new Date().toISOString()} against ${BASE_URL} (web 3104, db 4104).`,
  'Every check is a real HTTP request against the running app, a server action',
  'replayed from the HTML it rendered, a database read, or a named unit test.',
]);

const record = run.record.bind(run);
const expect = run.expect.bind(run);
const expectTest = run.expectTest.bind(run);

async function main() {
  // Nothing below means anything against an unseeded database, so the run stops
  // here rather than reporting a page full of empty checks.
  await db.season.findFirstOrThrow({ where: { status: 'OPEN' }, orderBy: { year: 'desc' } });

  const customer = new Session(BASE_URL);
  await signInCustomer(customer, DONOR);

  const donor = await db.customer.findUniqueOrThrow({ where: { normalizedEmail: DONOR.email } });

  // Carts left behind by an earlier run would answer some of these checks before
  // this one builds anything, so the run starts from no drafts at all.
  await db.order.deleteMany({ where: { status: 'DRAFT' } });

  const pickup = await db.pickupLocation.findFirstOrThrow({ where: { isActive: true } });
  const methods = await db.fulfillmentMethod.findMany({ where: { isActive: true } });
  const method = (code: string) => methods.find((row) => row.code === code)!.id;

  // ------------------------------------------------------------- S1 three-way
  const empty = await customer.get('/order');
  expect('S1a', 'The builder opens on an empty cart with the catalogue beside it',
    empty.status === 200 &&
      empty.body.includes('data-testid="builder-product-panel"') &&
      countOf(empty.body, 'cart-sidebar', 'item-count') === 0,
    `GET /order -> ${empty.status}, product panel present, sidebar item count 0`);

  const stock = await db.inventoryItem.findFirstOrThrow({
    where: { product: { slug: 'classic-mishloach-manos' } },
  });
  const cards = builderCards(empty.body);
  expect('S1b', 'Cards show live stock, product options and only their own add-ons',
    cards['classic-mishloach-manos'].unitsLeft === String(stock.onHand - stock.reserved) &&
      cards['classic-mishloach-manos'].html.includes('name="option:Size"') &&
      cards['deluxe-wine-basket'].html.includes('Extra bottle of wine') &&
      !cards['classic-mishloach-manos'].html.includes('Extra bottle of wine') &&
      cards['sponsor-a-family'].unitsLeft === 'unlimited',
    `classic ${cards['classic-mishloach-manos'].unitsLeft} left (inventory ${stock.onHand} on hand - ${stock.reserved} reserved), Size options on classic, wine add-on on the basket only, sponsorship unlimited`);

  const firstAdd = await addToCart(customer, 'classic-mishloach-manos', {
    quantity: '2',
    'option:Size': 'Large',
  });
  await addToCart(customer, 'deluxe-wine-basket', { quantity: '1', addOnIds: 'wine' });
  await addToCart(customer, 'sponsor-a-family', { quantity: '1' });

  const filled = await customer.get('/order');
  const lines = cartLines(filled.body);
  const draftLines = await db.orderLine.findMany({
    where: { order: { customerId: donor.id, status: 'DRAFT' } },
  });
  expect('S1c', 'Items and quantities go in first, with no recipient on any line',
    lines.length === 3 &&
      lines.every((line) => line.assigned === 'false') &&
      draftLines.length === 3 &&
      draftLines.every((line) => line.recipientName === null && line.fulfillmentMethodId === null) &&
      filled.body.includes('3 items still need a recipient'),
    `3 lines in the cart, all data-assigned="false"; database rows have recipientName and fulfillmentMethodId null; "${/(\d+) items still need a recipient/.exec(filled.body)?.[0]}"`);

  expect('S1d', 'Adding an item opens the picker for that line rather than a checkout',
    firstAdd.includes('assign=') && firstAdd.includes('notice='),
    `POST add-to-cart -> 303 ${firstAdd}`);

  const miriam = await db.customerAddress.findFirstOrThrow({
    where: { customerId: donor.id, recipientName: 'Miriam Klein' },
  });

  const selfPickup = await assign(customer, lines[0].id, {
    target: 'self',
    fulfillmentMethodId: method('pickup'),
    pickupLocationId: pickup.id,
    greetingMessage: 'Freilichen Purim',
  });
  const savedBook = await assign(customer, lines[1].id, {
    target: 'saved',
    customerAddressId: miriam.id,
    fulfillmentMethodId: method('deliver'),
  });
  const brandNew = await assign(customer, lines[2].id, {
    target: 'new',
    fulfillmentMethodId: method('deliver'),
    ...NEW_RECIPIENT,
  }, { add: true });

  const assigned = await customer.get('/order');
  const assignedLines = cartLines(assigned.body);
  const rows = await db.orderLine.findMany({
    where: { order: { customerId: donor.id, status: 'DRAFT' } },
    include: { fulfillmentMethod: true, pickupLocation: true },
    orderBy: { createdAt: 'asc' },
  });

  expect('S1e', 'The three-way picker assigns to self, to the address book and to somebody new',
    assignedLines.length === 3 &&
      assignedLines.every((line) => line.assigned === 'true') &&
      rows[0].recipientName === DONOR.fullName &&
      rows[0].pickupLocation?.name === pickup.name &&
      rows[1].recipientName === 'Miriam Klein' &&
      rows[1].customerAddressId === miriam.id &&
      rows[2].recipientName === NEW_RECIPIENT.recipientName &&
      rows[2].addressPostalCode === NEW_RECIPIENT.postalCode,
    `self -> ${rows[0].recipientName} at ${rows[0].pickupLocation?.name}; book -> ${rows[1].recipientName} by ${rows[1].fulfillmentMethod?.code}; new -> ${rows[2].recipientName}, ${rows[2].addressCity} ${rows[2].addressPostalCode}. Redirects: ${[selfPickup, savedBook, brandNew].map(noticeOf).join(' | ')}`);

  const savedNew = await db.customerAddress.findFirstOrThrow({
    where: { customerId: donor.id, recipientName: NEW_RECIPIENT.recipientName },
  });
  const picker = await customer.get(`/order?assign=${lines[0].id}`);
  expect('S1f', 'A new recipient joins the address book on the way past and is offered next time',
    savedNew.isArchived === false &&
      savedNew.city === NEW_RECIPIENT.city &&
      picker.body.includes(`value="${savedNew.id}"`) &&
      countOccurrences(picker.body, 'data-testid="edit-saved-address-link"') === 3,
    `${savedNew.recipientName} saved as "${savedNew.line1}, ${savedNew.city}" by the assignment itself; the picker now offers 3 saved recipients, each editable in place`);

  const expectedSubtotal = rows.reduce((total, line) => total + line.lineTotalCents, 0);
  const addOnTotal = await db.orderLineAddOn.aggregate({
    where: { orderLine: { order: { customerId: donor.id, status: 'DRAFT' } } },
    _sum: { lineTotalCents: true },
  });
  expect('S1g', 'Cart totals match the priced lines, including options and add-ons',
    centsOf(assigned.body, 'cart-subtotal') === expectedSubtotal + (addOnTotal._sum.lineTotalCents ?? 0) &&
      rows[0].lineTotalCents === 2 * (3600 + 1200),
    `sidebar subtotal ${dollars(centsOf(assigned.body, 'cart-subtotal'))} = lines ${dollars(expectedSubtotal)} + add-ons ${dollars(addOnTotal._sum.lineTotalCents ?? 0)}; 2 × Large classic = ${dollars(rows[0].lineTotalCents)}`);

  expect('S1h', 'One cart component serves the desktop sidebar and the phone FAB',
    countOf(assigned.body, 'cart-sidebar', 'item-count') === 4 &&
      countOf(assigned.body, 'cart-sheet', 'item-count') === 4 &&
      countOf(assigned.body, 'cart-sidebar', 'unassigned-count') === 0 &&
      assigned.body.includes('data-testid="mobile-cart-fab"') &&
      assigned.body.includes('data-testid="cart-ready"'),
    `sidebar and sheet both report 4 items and 0 unassigned; FAB present; "Every item has a recipient"`);

  // --------------------------------------------------------- S2 draft persistence
  const draft = await db.order.findFirstOrThrow({
    where: { customerId: donor.id, status: 'DRAFT' },
  });
  const refreshed = await customer.get('/order');
  const dashboard = await customer.get('/account');
  expect('S2a', 'A signed-in draft survives a refresh and shows up in the account',
    referenceOf(refreshed.body) === draft.draftReference &&
      dashboard.body.includes('data-testid="dashboard-draft"') &&
      dashboard.body.includes(draft.draftReference),
    `/order and /account both show ${draft.draftReference} after a fresh request`);

  const guest = new Session(BASE_URL);
  await addToCart(guest, 'classic-mishloach-manos', { quantity: '1', 'option:Size': 'Standard' });
  const guestBack = await guest.get('/order');
  const strangerCart = await new Session(BASE_URL).get('/order');
  const guestDraft = await db.order.findFirstOrThrow({
    where: { customerId: null, status: 'DRAFT' },
  });
  expect('S2b', 'A guest cart is held by a hashed token and is invisible without it',
    guest.cookie(GUEST_COOKIE) !== null &&
      cartLines(guestBack.body).length === 1 &&
      countOf(strangerCart.body, 'cart-sidebar', 'item-count') === 0 &&
      guestDraft.guestTokenHash !== null &&
      !guest.cookie(GUEST_COOKIE)!.includes(guestDraft.guestTokenHash!),
    `guest keeps 1 line across requests; a second browser sees 0 items; the row stores a ${guestDraft.guestTokenHash!.length}-character hash, not the cookie`);

  const guestOrderId = guestDraft.id;
  await signInCustomer(guest, FRIEND, { keepCookies: true });
  const friend = await db.customer.findUniqueOrThrow({ where: { normalizedEmail: FRIEND.email } });
  const claimed = await db.order.findUniqueOrThrow({ where: { id: guestOrderId } });
  expect('S2c', 'Signing in claims the guest cart, and the token is cleared only then',
    claimed.customerId === friend.id &&
      claimed.guestTokenHash === null &&
      guest.cookie(GUEST_COOKIE) === null,
    `${claimed.draftReference} moved to ${FRIEND.email}, guestTokenHash cleared, ${GUEST_COOKIE} cookie removed`);

  const second = new Session(BASE_URL);
  await addToCart(second, 'deluxe-wine-basket', { quantity: '1' });
  const secondToken = second.cookie(GUEST_COOKIE);
  const secondDraft = await db.order.findFirstOrThrow({ where: { customerId: null, status: 'DRAFT' } });
  await signInCustomer(second, FRIEND, { keepCookies: true });
  const unclaimed = await db.order.findUniqueOrThrow({ where: { id: secondDraft.id } });
  expect('S2d', 'A claim that cannot happen leaves the guest cart where it was',
    unclaimed.customerId === null &&
      unclaimed.guestTokenHash !== null &&
      second.cookie(GUEST_COOKIE) === secondToken &&
      cartLines((await second.get('/order')).body).length === 1,
    `${FRIEND.email} already had ${claimed.draftReference}, so ${unclaimed.draftReference} stayed a guest draft with its cookie intact`);

  const visitor = new Session(BASE_URL);
  await addToCart(visitor, 'classic-mishloach-manos', { quantity: '1', 'option:Size': 'Standard' });
  const guestLine = cartLines((await visitor.get('/order')).body)[0];
  const guestPicker = await visitor.get(`/order?assign=${guestLine.id}`);
  const guestSelf = await assign(visitor, guestLine.id, {
    target: 'self',
    recipientName: 'Yosef Guest',
    fulfillmentMethodId: method('pickup'),
    pickupLocationId: pickup.id,
  });
  const guestAssigned = await db.orderLine.findUniqueOrThrow({ where: { id: guestLine.id } });
  expect('S2g', 'A guest keeps a box on their own order, using the name field the picker shows them',
    guestPicker.body.includes('data-testid="self-recipient-name"') &&
      guestAssigned.recipientName === 'Yosef Guest' &&
      guestAssigned.pickupLocationId === pickup.id,
    `no account to read a name from, so the picker renders one field for it; posting it assigns the line to ${guestAssigned.recipientName}, picking up at ${pickup.name} (${noticeOf(guestSelf)})`);

  const stranger = new Session(BASE_URL);
  await signInCustomer(stranger, FRIEND);
  const otherDraft = await stranger.get(`/account/orders/${draft.id}`);
  const donorPlaced = await db.order.findFirstOrThrow({
    where: { customerId: donor.id, status: { not: 'DRAFT' } },
  });
  const otherPlaced = await stranger.get(`/account/orders/${donorPlaced.id}`);
  const invented = await stranger.get('/account/orders/ord_does_not_exist');
  expect('S2e', "A second browser cannot open another customer's draft or order",
    otherDraft.status === 404 && otherPlaced.status === 404 && invented.status === 404,
    `as ${FRIEND.email}: donor draft -> ${otherDraft.status}, donor placed order -> ${otherPlaced.status}, invented id -> ${invented.status} (same answer either way)`);

  const ownDetail = await customer.get(`/account/orders/${donorPlaced.id}`);
  const ownList = await customer.get('/account/orders');
  expect('S2f', 'The owner sees their own history, detail and draft controls',
    ownDetail.status === 200 &&
      ownDetail.body.includes(`Order #${donorPlaced.orderNumber}`) &&
      ownDetail.body.includes('data-testid="detail-package"') &&
      countOccurrences(ownList.body, 'data-testid="order-row"') === 2 &&
      (await customer.get(`/account/orders/${draft.id}`)).body.includes('data-testid="detail-cancel"'),
    `/account/orders lists 2 orders; #${donorPlaced.orderNumber} shows packages; the draft offers continue, pay-pending and cancel`);

  // ------------------------------------------------------- S3 address edits
  const beforeEdit = await customer.get(`/account/addresses?edit=${miriam.id}`);
  const editForm = formWith(beforeEdit.body, '/account/addresses', 'data-testid="address-submit"');
  await customer.submit(editForm, { line2: 'Apt 5C', label: 'Miriam K' });
  const editedRow = await db.customerAddress.findUniqueOrThrow({ where: { id: miriam.id } });
  const customerAudit = await db.auditEvent.findFirstOrThrow({
    where: { entityType: 'CustomerAddress', entityId: miriam.id },
    orderBy: { createdAt: 'desc' },
  });
  const draftLine = await db.orderLine.findFirstOrThrow({
    where: { customerAddressId: miriam.id, order: { status: 'DRAFT' } },
  });
  const placedLine = await db.orderLine.findFirstOrThrow({
    where: { customerAddressId: miriam.id, order: { status: { not: 'DRAFT' } } },
  });
  expect('S3a', 'A customer edits their own address: the draft follows it, the placed order does not',
    editedRow.line2 === 'Apt 5C' &&
      draftLine.addressLine2 === 'Apt 5C' &&
      placedLine.addressLine2 === 'Apt 3B' &&
      customerAudit.actorLabel === 'system' &&
      customerAudit.action === 'customer.address_saved',
    `${editedRow.recipientName}: line2 -> "${editedRow.line2}"; the draft line now reads "${draftLine.addressLine2}" while the placed order keeps "${placedLine.addressLine2}"; audit ${customerAudit.action} by ${customerAudit.actorLabel}`);

  const addresses = await customer.get('/account/addresses');
  const before = countOccurrences(addresses.body, 'data-testid="address-row"');
  const addForm = formWith(addresses.body, '/account/addresses', 'data-testid="address-submit"');
  const duplicate = await customer.submit(addForm, {
    recipientName: 'Tzvi Newman',
    line1: '17 cedar bridge avenue',
    line2: 'ste 4',
    city: 'toms river',
    state: 'nj',
    postalCode: '08753',
    phone: '',
    label: '',
  });
  const duplicateBody = await duplicate.text();
  const afterRows = await db.customerAddress.count({
    where: { customerId: donor.id, isArchived: false },
  });
  const deduped = await db.customerAddress.findUniqueOrThrow({ where: { id: savedNew.id } });
  expect('S3b', 'The same place typed differently lands on the row that is already there',
    afterRows === before && duplicateBody.includes('address is updated'),
    `"17 cedar bridge avenue / ste 4 / toms river nj" matched "${NEW_RECIPIENT.line1}": still ${afterRows} saved recipients, one key "${deduped.addressKey}"`);

  // No geocoding provider is wired up until routing (P9), so the cache is filled
  // here the way that provider will fill it, and the save is left to the UI.
  const tzvi = await db.customerAddress.findUniqueOrThrow({ where: { id: savedNew.id } });
  await db.geocodeCache.upsert({
    where: { addressKey: tzvi.addressKey },
    create: {
      addressKey: tzvi.addressKey,
      outcome: 'FOUND',
      latitude: 39.9537,
      longitude: -74.1979,
      provider: 'smoke-p4',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
    update: { outcome: 'FOUND', latitude: 39.9537, longitude: -74.1979 },
  });

  const tzviPage = await customer.get(`/account/addresses?edit=${tzvi.id}`);
  await customer.submit(formWith(tzviPage.body, '/account/addresses', 'data-testid="address-submit"'), {
    label: 'Toms River',
  });
  const located = await db.customerAddress.findUniqueOrThrow({ where: { id: tzvi.id } });
  const unlocated = await db.customerAddress.findUniqueOrThrow({ where: { id: miriam.id } });
  const rowsPage = await customer.get('/account/addresses');
  expect('S3c', 'Geocode fields come from the cache, and stay null when it has nothing',
    located.latitude === 39.9537 &&
      located.longitude === -74.1979 &&
      located.geocodedAt !== null &&
      unlocated.latitude === null &&
      unlocated.geocodedAt === null &&
      countOccurrences(rowsPage.body, 'data-geocoded="true"') === 1,
    `${located.recipientName} -> ${located.latitude}, ${located.longitude} at ${located.geocodedAt?.toISOString()}; ${unlocated.recipientName} has no cache row and keeps null coordinates rather than invented ones`);

  const manager = new Session(BASE_URL);
  await signInStaff(manager, MANAGER_EMAIL);
  const staffPage = await manager.get(`/admin/customers/${donor.id}?edit=${miriam.id}`);
  const staffForm = formWith(staffPage.body, `/admin/customers/${donor.id}`, 'data-testid="staff-address-submit"');
  await manager.submit(staffForm, { line2: 'Apt 6D', phone: '(555) 222-3344' });
  const staffEdited = await db.customerAddress.findUniqueOrThrow({ where: { id: miriam.id } });
  const staffAudit = await db.auditEvent.findFirstOrThrow({
    where: { entityType: 'CustomerAddress', entityId: miriam.id },
    orderBy: { createdAt: 'desc' },
  });
  expect('S3d', 'A staff edit to the same book names the staff member who made it',
    staffEdited.line2 === 'Apt 6D' &&
      staffAudit.actorLabel.includes(MANAGER_EMAIL) &&
      staffAudit.actorStaffUserId !== null,
    `line2 -> "${staffEdited.line2}"; audit ${staffAudit.action} by ${staffAudit.actorLabel} (staff id ${staffAudit.actorStaffUserId})`);

  const search = await manager.get('/admin/customers?q=donor');
  const driver = new Session(BASE_URL);
  await signInStaff(driver, DRIVER_EMAIL);
  const driverList = await driver.get('/admin/customers');
  const driverDetail = await driver.get(`/admin/customers/${donor.id}`);
  expect('S3e', 'The staff customer screens are behind their own permission',
    search.body.includes('data-testid="customer-table"') &&
      search.body.includes(DONOR.email) &&
      driverList.status === 403 &&
      driverDetail.status === 403,
    `manager search "donor" finds ${DONOR.email}; as DRIVER: /admin/customers -> ${driverList.status}, detail -> ${driverDetail.status}`);

  // --------------------------------------------------------- unit test citations
  const testRun = runTests(TEST_FILES, TEST_DATABASE_URL);
  const passedTests = new Set(testRun.passed);

  expectTest('P4-1', 'Cart-first behaviour is covered by unit tests', passedTests, [
    'items go into the cart with no recipient and no reservation',
    'the shelf is the ceiling, counting what is already in the cart',
    'an option has to be one the product offers, and it prices the line',
    'a restricted add-on is only offered, and only accepted, on its own product',
    'quantity zero removes the line, and add-ons follow the quantity',
  ]);

  expectTest('P4-2', 'Assignment and draft ownership are covered by unit tests', passedTests, [
    'the three-way picker: on the order, from the book, and somebody new',
    'assignment refuses what the form should not have been able to say',
    'clearing a recipient keeps the item, and the database refuses half an assignment',
    'checkout refuses an order that still has a line without a recipient',
    'a line only answers to the cart that owns it',
    'a draft is only discarded by the owner who built it',
    'a guest cart is reachable only with its own token',
    'signing in claims the guest cart, and a failed claim leaves it alone',
  ]);

  expectTest('P4-3', 'Address-book rules are covered by unit tests', passedTests, [
    'an address is normalized on the way in',
    'the same place typed differently lands on the row that is already there',
    'an edit that collides with another saved address is refused rather than merged',
    'coordinates come from the geocode cache and nowhere else',
    'validation refuses what the packing floor could not use',
    "one customer cannot read or write another customer's book",
    'editing a saved address follows the draft but never a placed order',
    'an address on a draft cannot be removed until those items move',
  ]);

  expectTest('P4-4', 'Audit attribution and profile ownership are covered by unit tests', passedTests, [
    "a staff edit names the staff member; the customer's own edit is system",
    'a profile edit writes the customer it was given, and phones stay unique',
  ]);

  record('P4-5', 'The P4 test files are green', testRun.failed.length === 0,
    `${testRun.passed.length} tests passed, ${testRun.failed.length} failed`);

  const ci = runCommand('npm', ['run', 'ci'], envWithoutDatabaseUrl());
  record('P4-6', 'Lint, typecheck, migration guard and the whole suite pass', ci.status === 0,
    ci.status === 0 ? 'npm run ci exited 0' : ci.output.trim().split('\n').slice(-6).join(' / '));

  run.write();
}

/** Signs a customer in through the account form, the way a customer would. */
async function signInCustomer(
  session: Session,
  who: { email: string; fullName: string },
  options: { keepCookies?: boolean } = {},
) {
  if (!options.keepCookies) session.clearCookies();

  const page = await session.get('/account/sign-in');
  const form = parseForms(page.body, '/account/sign-in')[0];
  const response = await session.submit(form, { email: who.email, fullName: who.fullName });
  if (response.status !== 303) throw new Error(`Customer sign-in for ${who.email} returned ${response.status}`);
}

async function signInStaff(session: Session, email: string) {
  session.clearCookies();
  const page = await session.get('/sign-in');
  const response = await session.submit(parseForms(page.body, '/sign-in')[0], { email });
  if (response.status !== 303) throw new Error(`Staff sign-in for ${email} returned ${response.status}`);
}

/**
 * Posts one product card's add form. Add-ons are named by slug here so the
 * checks read as intent rather than as ids.
 */
async function addToCart(
  session: Session,
  slug: string,
  values: Record<string, string>,
): Promise<string> {
  const page = await session.get('/order');
  const form = parseForms(page.body, '/order').find((candidate) => candidate.fields.slug === slug);
  if (!form) throw new Error(`No add form for ${slug} on the builder`);

  const addOnIds = values.addOnIds ? await addOnId(values.addOnIds) : undefined;
  const response = await session.submit(form, {
    ...values,
    ...(addOnIds ? { addOnIds } : {}),
  });

  return redirectOf(response, `adding ${slug}`);
}

/** Opens the picker at its URL and posts it, exactly as the panel renders it. */
async function assign(
  session: Session,
  lineId: string,
  values: Record<string, string>,
  options: { add?: boolean } = {},
): Promise<string> {
  const path = `/order?assign=${lineId}${options.add ? '&add=1' : ''}`;
  const page = await session.get(path);
  const marker = options.add ? 'data-testid="add-recipient-submit"' : 'data-testid="assign-submit"';
  const form = formWith(page.body, path, marker);

  return redirectOf(await session.submit(form, { lineId, ...values }), `assigning ${lineId}`);
}

async function addOnId(slug: string): Promise<string> {
  const addOn = await db.addOn.findFirstOrThrow({ where: { slug: { contains: slug } } });
  return addOn.id;
}

main()
  .catch((error) => {
    console.error(`\nSmoke run stopped: ${error instanceof Error ? error.message : error}`);
    run.write();
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
