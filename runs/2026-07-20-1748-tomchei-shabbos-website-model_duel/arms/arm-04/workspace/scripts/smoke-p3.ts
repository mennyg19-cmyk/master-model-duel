import { PrismaClient } from '@prisma/client';

import { DATABASE_URL, TEST_DATABASE_URL } from './db-server';
import { findForm, parseForms, Session } from './http-form';
import { createSolidPng } from './png';
import { envWithoutDatabaseUrl, runCommand, runTests, SmokeRun } from './smoke-harness';

/**
 * Phase P3 smoke run. P3 is the first phase with a storefront, so the evidence
 * is HTTP: real pages fetched from a running server and real server actions
 * replayed from the HTML they rendered. Nothing is asserted against a mock.
 *
 * Expects `npm run dev` (or `start`) up on 3104 with the seeded database.
 */
const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3104';

const MANAGER_EMAIL = 'manager@tomchei.example';

const TEST_FILES = [
  'tests/catalog-browse.test.ts',
  'tests/catalog-admin.test.ts',
  'tests/media.test.ts',
  'tests/newsletter.test.ts',
];

const db = new PrismaClient({ datasourceUrl: DATABASE_URL });

const run = new SmokeRun('P3', [
  `Run at ${new Date().toISOString()} against ${BASE_URL} (web 3104, db 4104).`,
  'Every check below is a real HTTP request against the running app, a server',
  'action replayed from the HTML it rendered, or a named unit test.',
]);

const record = run.record.bind(run);
const expect = run.expect.bind(run);
const expectTest = run.expectTest.bind(run);

async function main() {
  const visitor = new Session(BASE_URL);
  const manager = new Session(BASE_URL);
  await signIn(manager, MANAGER_EMAIL);

  const season = await db.season.findFirstOrThrow({
    where: { status: 'OPEN' },
    orderBy: { year: 'desc' },
  });

  // ------------------------------------------------------------------- S1
  const home = await visitor.get('/');
  const homeSections = ['mission', 'impact-bar', 'how-it-works', 'testimonials'].filter(
    (section) => home.body.includes(`data-testid="${section}"`),
  );
  expect('S1a', 'Homepage carries mission, impact bar, how-it-works and testimonials',
    home.status === 200 && homeSections.length === 4 && home.body.includes('data-testid="home-order-cta"'),
    `GET / -> ${home.status} with ${homeSections.join(', ')} and the order CTA (store open)`);

  expect('S1b', 'Storefront shell: desktop nav, mobile menu, user menu and a footer signup',
    home.body.includes('aria-label="Main"') &&
      home.body.includes('data-testid="mobile-menu"') &&
      home.body.includes('aria-label="Mobile"') &&
      home.body.includes('data-testid="newsletter-signup"'),
    'sticky header renders both navs, the <details> mobile menu and the footer signup form');

  const collection = await visitor.get('/collection');
  const seededCards = productCards(collection.body);
  const seededSlugs = ['classic-mishloach-manos', 'deluxe-wine-basket', 'sponsor-a-family'];
  expect('S1c', 'Current-season catalog renders the seeded products',
    collection.status === 200 &&
      seededSlugs.every((slug) => seededCards.some((card) => card.slug === slug)),
    `GET /collection -> ${collection.status} with ${seededCards.length} cards: ${seededCards.map((card) => card.slug).join(', ')}`);

  const filtered = await visitor.get('/collection?category=Boxes');
  const boxes = productCards(filtered.body);
  expect('S1d', 'Category filter narrows the grid to that category',
    boxes.length > 0 && boxes.every((card) => card.category === 'Boxes'),
    `?category=Boxes -> ${boxes.map((card) => `${card.slug} (${card.category})`).join(', ')}`);

  const cheapest = await visitor.get('/collection?sort=price-asc');
  const dearest = await visitor.get('/collection?sort=price-desc');
  const ascending = productCards(cheapest.body).map((card) => card.slug);
  const descending = productCards(dearest.body).map((card) => card.slug);
  expect('S1e', 'Price sort reverses the grid and uses the price the card shows',
    ascending[0] === 'classic-mishloach-manos' && descending[0] === 'sponsor-a-family',
    `price-asc: ${ascending.join(' < ')} | price-desc: ${descending.join(' > ')}`);

  const quick = await visitor.get('/collection?quick=classic-mishloach-manos');
  expect('S1f', 'Quick view opens from a URL and prices the options',
    quick.body.includes('data-testid="quick-view"') &&
      quick.body.includes('data-slug="classic-mishloach-manos"') &&
      quick.body.includes('Large (+$12.00)'),
    'GET /collection?quick=classic-mishloach-manos renders the panel with Standard, Large (+$12.00)');

  const detail = await visitor.get('/collection/classic-mishloach-manos');
  expect('S1g', 'Detail page shows option pricing and the ordering control',
    detail.status === 200 &&
      detail.body.includes('$36.00') &&
      detail.body.includes('$48.00') &&
      detail.body.includes('data-testid="detail-order-cta"'),
    `GET /collection/classic-mishloach-manos -> ${detail.status}, $36.00 base with the $48.00 large option`);

  const photo = await db.mediaAsset.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
  const optimized = await visitor.get(
    `/_next/image?url=${encodeURIComponent(photo.url)}&w=640&q=75`,
  );
  expect('S1h', 'A seeded catalog photo is served and decodes as a real image',
    collection.body.includes('data-testid="product-card"') && optimized.status === 200,
    `GET /_next/image for ${photo.pathname} -> ${optimized.status} (the optimizer decoded the PNG)`);

  // Sold-out handling: hold every unit of the basket, then hand them back.
  const basket = await db.product.findUniqueOrThrow({
    where: { seasonId_slug: { seasonId: season.id, slug: 'deluxe-wine-basket' } },
    include: { inventory: true },
  });
  await db.inventoryItem.update({
    where: { productId: basket.id },
    data: { reserved: basket.inventory?.onHand ?? 0 },
  });

  const withSoldOut = productCards((await visitor.get('/collection')).body);
  const soldOutCard = withSoldOut.find((card) => card.slug === 'deluxe-wine-basket');
  expect('S1i', 'A sold-out product stays in the grid, sinks to the end and loses its buy control',
    soldOutCard?.soldOut === true &&
      withSoldOut.at(-1)?.slug === 'deluxe-wine-basket' &&
      !soldOutCard.html.includes('data-testid="product-order-cta"'),
    `deluxe-wine-basket renders last with a Sold out badge and no order CTA (${withSoldOut.map((card) => card.slug).join(' → ')})`);

  await db.inventoryItem.update({ where: { productId: basket.id }, data: { reserved: 0 } });

  // ------------------------------------------------------------------- S2
  await setStoreOpen(manager, false);

  const closedHome = await visitor.get('/');
  const closedCollection = await visitor.get('/collection');
  const closedOrder = await visitor.request('/order');
  expect('S2a', 'Closing the store hides every buy control and blocks /order server-side',
    closedHome.body.includes('data-testid="closed-banner"') &&
      !closedHome.body.includes('data-testid="home-order-cta"') &&
      !closedCollection.body.includes('data-testid="product-order-cta"') &&
      closedOrder.status === 403,
    `closed banner shown, no CTAs on / or /collection, GET /order -> ${closedOrder.status}`);

  const archiveIndex = await visitor.get('/archive');
  const archiveYear = await visitor.get(`/archive/${season.year - 1}`);
  const archiveCards = productCards(archiveYear.body);
  expect('S2b', 'The archive stays browsable with no way to order from it',
    archiveIndex.status === 200 &&
      archiveIndex.body.includes(`/archive/${season.year - 1}`) &&
      archiveYear.status === 200 &&
      archiveCards.length > 0 &&
      !archiveYear.body.includes('data-testid="product-order-cta"') &&
      archiveYear.body.includes('data-testid="archive-notice"'),
    `GET /archive -> ${archiveIndex.status} listing ${season.year - 1}; that year shows ${archiveCards.length} products with no order CTA`);

  await setStoreOpen(manager, true);
  const reopened = await visitor.request('/order');
  expect('S2c', 'Reopening the store unblocks ordering again',
    reopened.status === 200,
    `GET /order after reopening -> ${reopened.status}`);

  // ------------------------------------------------------------------- S3
  const subscriberEmail = `smoke-${Date.now().toString(36)}@example.test`;
  const signupForm = findForm(parseForms(home.body, '/'), { source: 'footer' });
  const signup = await visitor.submit(signupForm, { email: subscriberEmail });
  const subscribed = await db.newsletterSubscriber.findUnique({
    where: { normalizedEmail: subscriberEmail },
  });
  expect('S3a', 'The footer form puts a new address on the list',
    signup.status === 200 && subscribed?.status === 'SUBSCRIBED',
    `POST footer signup -> ${signup.status}, ${subscriberEmail} stored as ${subscribed?.status} from source "${subscribed?.source}"`);

  const manageUrl = newsletterLink(subscriberEmail);
  const managePage = await visitor.get(pathOf(manageUrl));
  expect('S3b', 'The signed link opens the preferences page with no session',
    managePage.status === 200 &&
      managePage.body.includes('data-testid="manage-newsletter"') &&
      managePage.body.includes(subscriberEmail),
    `GET /newsletter/manage?token=… -> ${managePage.status} for ${subscriberEmail}`);

  const preferencesForm = findForm(parseForms(managePage.body, pathOf(manageUrl)), {
    'preferences-present': '1',
  });
  await visitor.submit(preferencesForm, {
    wantsSeasonAnnouncements: 'on',
    wantsOrderReminders: '',
    wantsImpactStories: 'on',
  });
  const afterPreferences = await db.newsletterSubscriber.findUniqueOrThrow({
    where: { normalizedEmail: subscriberEmail },
  });
  expect('S3c', 'Preferences save per subscriber, from the token alone',
    afterPreferences.wantsSeasonAnnouncements &&
      !afterPreferences.wantsOrderReminders &&
      afterPreferences.wantsImpactStories,
    `announcements ${afterPreferences.wantsSeasonAnnouncements}, reminders ${afterPreferences.wantsOrderReminders}, stories ${afterPreferences.wantsImpactStories}`);

  // Both forms on the page carry the token; only the unsubscribe one has no
  // preference checkboxes behind it.
  const unsubscribeForm = parseForms(managePage.body, pathOf(manageUrl)).find(
    (form) =>
      form.fields.token === tokenOf(manageUrl) && form.fields['preferences-present'] === undefined,
  );
  if (!unsubscribeForm) throw new Error('No unsubscribe control on the preferences page');

  const unsubscribed = await visitor.submit(unsubscribeForm);
  const afterUnsubscribe = await db.newsletterSubscriber.findUniqueOrThrow({
    where: { normalizedEmail: subscriberEmail },
  });
  expect('S3d', 'Unsubscribing is a POST, keeps the row and records when it happened',
    (unsubscribed.headers.get('location') ?? '').includes('/newsletter/unsubscribe?state=done') &&
      afterUnsubscribe.status === 'UNSUBSCRIBED' &&
      afterUnsubscribe.unsubscribedAt !== null,
    `POST unsubscribe -> ${unsubscribed.status} ${unsubscribed.headers.get('location')}, row kept with unsubscribedAt ${afterUnsubscribe.unsubscribedAt?.toISOString()}`);

  const tampered = await visitor.get(`/newsletter/manage?token=${tokenOf(manageUrl)}x`);
  expect('S3e', 'A tampered token is refused instead of trusted',
    tampered.body.includes('data-testid="token-error"') &&
      tampered.body.includes('has been altered'),
    'GET /newsletter/manage with one character appended to the signature renders the error, not the page');

  // ------------------------------------------------------------------- S4
  const mediaPage = await manager.get('/admin/media');
  expect('S4a', 'The media library is behind its own permission and offers an upload',
    mediaPage.status === 200 && mediaPage.body.includes('data-testid="media-upload-form"'),
    `GET /admin/media as manager -> ${mediaPage.status}`);

  const uploadForm = findForm(parseForms(mediaPage.body, '/admin/media'), { file: '' });
  const goodUpload = await manager.submit(uploadForm, {
    file: new File([new Uint8Array(createSolidPng(400, 300, [40, 90, 140]))], 'smoke-upload.png', {
      type: 'image/png',
    }),
    altText: 'A smoke-test photo of a gift box',
  });
  const storedAsset = await db.mediaAsset.findFirst({
    where: { originalFilename: 'smoke-upload.png' },
    orderBy: { createdAt: 'desc' },
  });
  expect('S4b', 'A real PNG uploads, is stored and is audited',
    goodUpload.status === 200 && Boolean(storedAsset),
    `POST upload -> ${goodUpload.status}, stored as ${storedAsset?.pathname} (${storedAsset?.storage}, ${storedAsset?.sizeBytes} bytes)`);

  const disguised = await manager.submit(uploadForm, {
    file: new File(['<svg onload="steal()"></svg>'], 'not-really.png', { type: 'image/png' }),
    altText: 'A script pretending to be a photo',
  });
  const disguisedBody = await disguised.text();
  const disguisedStored = await db.mediaAsset.count({
    where: { originalFilename: 'not-really.png' },
  });
  expect('S4c', 'A file that only claims to be an image is rejected and never stored',
    disguisedBody.includes('not the image it claims to be') && disguisedStored === 0,
    `upload of a .png containing SVG markup -> rejected ("not the image it claims to be"), ${disguisedStored} rows written`);

  const catalogPage = await manager.get('/admin/catalog');
  expect('S4d', 'Admin catalog lists the season with a needs-photos panel',
    catalogPage.status === 200 &&
      catalogPage.body.includes('data-testid="product-table"') &&
      catalogPage.body.includes('data-testid="needs-photos"'),
    `GET /admin/catalog -> ${catalogPage.status}, needs-photos names ${needsPhotos(catalogPage.body).join(', ')}`);

  // The create form is the product form with no product to edit behind it.
  const productForm = parseForms(catalogPage.body, '/admin/catalog').find(
    (form) => form.fields.productId === undefined && form.html.includes('name="slug"'),
  );
  if (!productForm) throw new Error('No create-product form on the admin catalog page');

  const newSlug = `smoke-gift-box-${Date.now().toString(36)}`;
  const created = await manager.submit(productForm, {
    seasonId: season.id,
    name: 'Smoke Gift Box',
    slug: newSlug,
    category: 'Boxes',
    price: '54.00',
    kind: 'PACKAGE',
    description: 'Created through the admin form during the P3 smoke run.',
    imageAssetId: storedAsset?.id ?? '',
    sortOrder: '9',
    tracksInventory: '',
    isActive: 'on',
  });

  const storefrontAfterCreate = await visitor.get('/collection');
  const createdCard = productCards(storefrontAfterCreate.body).find((card) => card.slug === newSlug);
  expect('S4e', 'A product created in the admin appears in the storefront grid with its photo',
    created.status === 200 &&
      Boolean(createdCard) &&
      createdCard!.html.includes('$54.00') &&
      createdCard!.html.includes(encodeURIComponent(storedAsset?.url ?? 'no-photo')),
    `POST create -> ${created.status}; /collection shows ${newSlug} at $54.00 using ${storedAsset?.pathname}`);

  const needsPhotosAfter = needsPhotos((await manager.get('/admin/media')).body);
  expect('S4f', 'The needs-photos panel tracks what is still missing a photo',
    !needsPhotosAfter.includes('Smoke Gift Box') && needsPhotosAfter.length > 0,
    `still without photos: ${needsPhotosAfter.join(', ')}; the product just given one is gone from the list`);

  // ------------------------------------------------------------------- S5
  const outsideZip = '11219';
  const before = await visitor.get(`/order?zip=${outsideZip}`);
  expect('S5a', 'A ZIP outside the delivery area is refused with shipping offered instead',
    deliverable(before.body) === 'false' && before.body.includes('Volunteers do not drive'),
    `GET /order?zip=${outsideZip} -> data-deliverable="${deliverable(before.body)}"`);

  const shippingPage = await manager.get('/admin/settings/shipping');
  const shippingForm = parseForms(shippingPage.body, '/admin/settings/shipping').find((form) =>
    form.html.includes('name="deliveryZips"'),
  );
  if (!shippingForm) throw new Error('No shipping settings form to submit');

  const existingZips = await currentZips();
  await manager.submit(shippingForm, {
    baseRate: '12.00',
    freeShippingThreshold: '150.00',
    deliveryZips: [...existingZips, outsideZip].join('\n'),
  });

  const after = await visitor.get(`/order?zip=${outsideZip}`);
  expect('S5b', 'Adding the ZIP in settings changes the answer on the next request',
    deliverable(after.body) === 'true' && (await currentZips()).includes(outsideZip),
    `after saving settings, GET /order?zip=${outsideZip} -> data-deliverable="${deliverable(after.body)}" with no restart`);

  const rejectedZips = await manager.submit(shippingForm, {
    baseRate: '12.00',
    freeShippingThreshold: '150.00',
    deliveryZips: `${existingZips.join('\n')}\nLakewood`,
  });
  expect('S5c', 'A ZIP list entry that is not a ZIP code is reported, not silently dropped',
    (rejectedZips.headers.get('location') ?? '').includes('error='),
    `saving "Lakewood" as a ZIP -> ${rejectedZips.status} ${decodeURIComponent(rejectedZips.headers.get('location') ?? '')}`);

  const settingsTabs = await manager.get('/admin/settings');
  const developer = await manager.get('/admin/settings/developer');
  const email = await manager.get('/admin/settings/email');
  expect('P3-1', 'The settings hub covers Orders, Shipping, Email and Developer',
    settingsTabs.body.includes('data-testid="package-types"') &&
      settingsTabs.body.includes('data-testid="pickup-locations"') &&
      shippingPage.body.includes('data-testid="delivery-zips"') &&
      email.status === 200 &&
      developer.status === 200 &&
      developer.body.includes('data-testid="developer-facts"') &&
      developer.body.includes('data-testid="cron-runs"'),
    'Orders (store status, follow-up, box sizes, pickup locations), Shipping (rates + ZIPs), Email (sender + counts), Developer (runtime facts + cron history)');

  const addOns = await manager.get('/admin/catalog/add-ons');
  expect('P3-2', 'Add-on management ships alongside the product editor',
    addOns.status === 200 &&
      addOns.body.includes('data-testid="add-on-list"') &&
      addOns.body.includes('Extra bottle of wine'),
    `GET /admin/catalog/add-ons -> ${addOns.status} listing the seeded add-ons with their product restrictions`);

  const createdProductId = await productIdOf(newSlug);
  const productPage = await manager.get(`/admin/catalog/${createdProductId}`);
  expect('P3-3', 'The product editor carries the replacement-link control',
    productPage.status === 200 && productPage.body.includes('data-testid="replacement-editor"'),
    `GET /admin/catalog/{id} -> ${productPage.status} with the replacement-link editor`);

  // The season control is gone from the editor, so posting one is exactly the
  // tampered request the server now has to refuse on its own.
  const editForm = parseForms(productPage.body, `/admin/catalog/${createdProductId}`).find(
    (form) => form.fields.productId === createdProductId && form.html.includes('name="slug"'),
  );
  if (!editForm) throw new Error('No product edit form on the product page');

  const previousSeason = await db.season.findFirstOrThrow({ where: { year: season.year - 1 } });

  const moveAttempt = await manager.submit(editForm, {
    seasonId: previousSeason.id,
    kind: 'PACKAGE',
    imageAssetId: storedAsset?.id ?? '',
    description: 'Edited during the P3 fix smoke run.',
    isActive: 'on',
  });
  const afterMove = await db.product.findUniqueOrThrow({ where: { id: createdProductId } });
  expect('P3-11', 'A season posted behind the product editor cannot move the product',
    moveAttempt.status === 200 && afterMove.seasonId === season.id,
    `POST edit with seasonId=${previousSeason.label} -> ${moveAttempt.status}, product still in ${season.label}`);

  const archiveProduct = await db.product.findFirstOrThrow({ where: { seasonId: previousSeason.id } });
  const addOnForm = parseForms(addOns.body, '/admin/catalog/add-ons').find(
    (form) => form.fields.addOnId === undefined && form.html.includes('name="slug"'),
  );
  if (!addOnForm) throw new Error('No create add-on form on the add-ons page');

  const crossSeason = await manager.submit(addOnForm, {
    seasonId: season.id,
    name: 'Smoke cross-season add-on',
    slug: `smoke-cross-${Date.now().toString(36)}`,
    price: '9.00',
    isActive: 'on',
    restrictedToProductIds: archiveProduct.id,
  });
  const crossSeasonBody = await crossSeason.text();
  const crossSeasonRows = await db.addOnProductRestriction.count({
    where: { productId: archiveProduct.id },
  });
  expect('P3-12', 'An add-on cannot be restricted to a product from another season',
    crossSeasonBody.includes('can only be restricted to products in') && crossSeasonRows === 0,
    `POST add-on restricted to a ${previousSeason.label} product -> refused, ${crossSeasonRows} restriction rows written`);

  const staffSession = new Session(BASE_URL);
  await signIn(staffSession, 'staff@tomchei.example');
  const staffCatalog = await staffSession.request('/admin/catalog');
  const staffMedia = await staffSession.request('/admin/media');
  expect('P3-4', 'Catalog and media are gated by their own permissions',
    staffCatalog.status === 403 && staffMedia.status === 403,
    `as STAFF: /admin/catalog -> ${staffCatalog.status}, /admin/media -> ${staffMedia.status}`);

  // --------------------------------------------------------- unit test citations
  const testRun = runTests(TEST_FILES, TEST_DATABASE_URL);
  const passedTests = new Set(testRun.passed);

  expectTest('S3f', 'Tampered and expired unsubscribe tokens are covered by unit tests', passedTests, [
    'an unsubscribe token round-trips and names the subscriber',
    'a tampered, truncated or missing token is refused',
    'a token stops working once it expires',
  ]);

  expectTest('P3-5', 'Upload validation rules are covered by unit tests', passedTests, [
    'a real PNG with alt text is accepted',
    'an image with no alt text is rejected before anything else',
    'the bytes decide, not the name or the declared type',
    'empty and oversized files are rejected',
    'the stored pathname cannot escape the upload folder',
  ]);

  expectTest('P3-6', 'Catalog browsing and delivery ZIP rules are covered by unit tests', passedTests, [
    'sold-out products stay in the grid but sink below what can be bought',
    'category filtering keeps only that category',
    'price sorting uses the cheapest way to buy the product',
    'delivery is refused outside the configured area and when nothing is configured',
    'the delivery ZIP textarea dedupes, sorts and reports what it rejected',
  ]);

  expectTest('P3-7', 'Subscribing twice, and re-subscribing after opting out, are covered', passedTests, [
    'subscribing twice keeps one row and is not an error',
    'a malformed address never reaches the database',
    'preferences and unsubscribing work from the signed link alone',
    'an unknown subscriber id fails the same way a bad signature does',
  ]);

  expectTest('P3-10', 'The catalog admin trust boundary is covered by unit tests', passedTests, [
    'a replacement has to come from a later season',
    'an add-on can only be restricted to products in its own season',
    'a saved product keeps the season it was created in',
    'form-supplied ids that name nothing come back as a message, not a crash',
    'a size of zero is not a size',
  ]);

  record('P3-8', 'The P3 test files are green', testRun.failed.length === 0,
    `${testRun.passed.length} tests passed, ${testRun.failed.length} failed`);

  const ci = runCommand('npm', ['run', 'ci'], envWithoutDatabaseUrl());
  record('P3-9', 'Lint, typecheck, migration guard and the whole suite pass', ci.status === 0,
    ci.status === 0 ? 'npm run ci exited 0' : ci.output.trim().split('\n').slice(-5).join(' / '));

  run.write();
}

async function signIn(session: Session, email: string) {
  session.clearCookies();
  const page = await session.get('/sign-in');
  const response = await session.submit(parseForms(page.body, '/sign-in')[0], { email });
  if (response.status !== 303) throw new Error(`Sign-in for ${email} returned ${response.status}`);
}

/** Uses the manager's own toggle rather than writing the setting behind the UI. */
async function setStoreOpen(session: Session, open: boolean) {
  const page = await session.get('/admin/settings');
  const form = parseForms(page.body, '/admin/settings').find(
    (candidate) => candidate.fields.open !== undefined,
  );
  if (!form) throw new Error('No store status control on the settings page');

  // The button reads "Close the store" when open, so its hidden value is the
  // state it moves to; if that is already what we want, nothing to do.
  if (form.fields.open !== String(open)) return;
  await session.submit(form);
}

type Card = { slug: string; category: string; soldOut: boolean; html: string };

/** Each chunk runs from one card marker to the next, so a card's HTML is its own. */
function productCards(html: string): Card[] {
  return html
    .split('data-testid="product-card"')
    .slice(1)
    .map((chunk) => ({
      slug: /data-slug="([^"]*)"/.exec(chunk)?.[1] ?? '',
      category: /data-category="([^"]*)"/.exec(chunk)?.[1] ?? '',
      soldOut: /data-sold-out="true"/.test(chunk),
      html: chunk,
    }));
}

function needsPhotos(html: string): string[] {
  return [...html.matchAll(/data-testid="needs-photo-link"[^>]*>([^<]+)</g)].map((match) =>
    match[1].trim(),
  );
}

function deliverable(html: string): string {
  return /data-deliverable="([^"]*)"/.exec(html)?.[1] ?? 'absent';
}

/**
 * The preferences link normally arrives by email. Email sending is a later
 * phase, so the smoke run gets the link the same way a developer does: from the
 * script that prints it.
 */
function newsletterLink(email: string): string {
  const printed = runCommand('node', [
    '--import', 'tsx',
    '--conditions=react-server',
    '--env-file=.env',
    'scripts/newsletter-link.ts',
    email,
  ]);

  const url = printed.output.split('\n').find((line) => line.includes('/newsletter/manage?token='));
  if (!url) throw new Error(`No preferences link printed for ${email}: ${printed.output}`);
  return url.trim();
}

function pathOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function tokenOf(url: string): string {
  return new URL(url).searchParams.get('token') ?? '';
}

async function currentZips(): Promise<string[]> {
  const row = await db.setting.findUnique({ where: { key: 'shipping.deliveryZips' } });
  return Array.isArray(row?.value) ? (row.value as string[]) : [];
}

async function productIdOf(slug: string): Promise<string> {
  const product = await db.product.findFirstOrThrow({ where: { slug } });
  return product.id;
}

main()
  .catch((error) => {
    console.error(`\nSmoke run stopped: ${error instanceof Error ? error.message : error}`);
    run.write();
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
