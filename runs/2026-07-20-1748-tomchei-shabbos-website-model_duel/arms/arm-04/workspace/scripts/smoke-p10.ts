import { PrismaClient, type Order, type Product, type Season } from '@prisma/client';

import { DATABASE_URL, TEST_DATABASE_URL } from './db-server';
import { findForm, parseForms, Session } from './http-form';
import { envWithoutDatabaseUrl, runCommand, runTests, SmokeRun } from './smoke-harness';
import { formWith } from './smoke-p4-helpers';
import {
  dollars,
  flashOf,
  formIn,
  locationOf,
  repeatLines,
  replacementRows,
  seasonCards,
} from './smoke-p10-helpers';
import { normalizeAddressKey } from '../src/lib/core/normalize';
import { seasonYearFor } from '../src/lib/core/season';
import { importPriorYearOrder } from '../src/lib/imports/prior-year-orders';
import { createDraftReference } from '../src/lib/orders/draft-reference';

/**
 * Phase P10 smoke run: replacement mappings, repeat orders and the season
 * calendar, driven over HTTP against the running app.
 *
 * The run builds two Purims of history first — a 2025 order whose boxes have
 * variously survived, been folded into something else, or vanished — and then
 * plays out what the org does with it: a family orders the same again and is
 * made to look at the swaps and the addresses before anything exists, the
 * office repeats one order and then a whole list of them, a year-one import
 * gets the same treatment, and a manager sets next Purim up and lets the clock
 * open it.
 *
 * Against the EXPECTED table: S1 is the discontinued-item repeat, S2 the staff
 * and bulk repeats, S3 the imported prior-year repeat, S4 the season wizard and
 * the scheduled auto-flip.
 *
 * Expects `npm run dev` up on 3104 against the seeded database.
 */
const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3104';
const CRON_SECRET = process.env.CRON_SECRET ?? '';

const MANAGER_EMAIL = 'manager@tomchei.example';
const OFFICE_EMAIL = 'staff@tomchei.example';

const CLASSIC = 'classic-mishloach-manos';
const DELUXE = 'deluxe-wine-basket';

/** Retired catalogue rows the run needs history to point at. */
const SAMPLER = 'family-sampler-tray';
const MINI = 'mini-sampler-tray';
const HEIRLOOM = 'heirloom-wine-basket';
const LEGACY_HAMPER = 'legacy-deluxe-hamper';

const SEASONS = '/admin/seasons';
const WIZARD = '/admin/seasons/new';
const MAPPINGS = '/admin/catalog/replacements';
const DIRECTORY = '/admin/customers';

const TEST_FILES = ['tests/repeat-seasons.test.ts', 'tests/scheduled-jobs.test.ts'];

const db = new PrismaClient({ datasourceUrl: DATABASE_URL });

const stamp = Date.now();
const thisYear = seasonYearFor(new Date());

const run = new SmokeRun('P10', [
  `Run at ${new Date().toISOString()} against ${BASE_URL} (web 3104, db 4104).`,
  '',
  `Three seasons of history are built first: ${thisYear - 2} and ${thisYear - 1} are closed,`,
  `${thisYear} is the open one, and the wizard makes ${thisYear + 1}. Every check below is a`,
  'real HTTP request against the running app; the database is read afterwards to',
  'see what the request actually wrote.',
  '',
  'EXPECTED smoke rows map onto these checks as: S1 → S1a–S1f, S2 → S2a–S2b and',
  'S4b–S4c, S3 → S3a–S3c.',
]);

const record = run.record.bind(run);
const expect = run.expect.bind(run);
const expectTest = run.expectTest.bind(run);

async function main() {
  const world = await buildHistory();
  const {
    current,
    lastYear,
    twoYearsAgo,
    currentClassic,
    currentDeluxe,
    buyer,
    malka,
    source,
  } = world;

  // ------------------------------------- S1 the family orders the same again
  const family = new Session(BASE_URL);
  await signInCustomer(family, buyer.email, 'Shaindy Kessler');

  const reviewPath = `/account/orders/${source.id}/repeat`;
  const ordersPage = await family.get('/account/orders');
  const review = await family.get(reviewPath);
  const lines = repeatLines(review.body);
  const [same, mapped, gone, moved] = lines;

  expect('S1a', 'The review page says what each of last year\u2019s items is now, before anything exists',
    review.status === 200 &&
      ordersPage.body.includes(reviewPath) &&
      lines.length === 4 &&
      same.resolution === 'same' &&
      mapped.resolution === 'mapped' &&
      gone.resolution === 'needs_choice' &&
      moved.resolution === 'same' &&
      review.body.includes('data-needs-choice="1"') &&
      (await db.order.count({ where: { customerId: buyer.id, status: 'DRAFT' } })) === 0,
    `${lines.length} lines off the ${twoYearsAgo.year} order: the classic box is still sold (same), the sampler tray resolves through ${MINI} to this year's box (mapped), the heirloom basket has nowhere to land (needs_choice), and looking at the page wrote no draft`);

  expect('S1b', 'The item nobody sells any more is offered the closest thing to what they paid',
    gone.suggestedProductId === currentDeluxe.id &&
      gone.html.includes('Choose what to send instead') &&
      mapped.html.includes('became'),
    `the $54.00 heirloom basket suggests ${currentDeluxe.name} at ${dollars(currentDeluxe.priceCents)} — the classic box is the same $18.00 away but the basket is in the same category, and the select still starts blank so the customer picks`);

  expect('S1c', 'The recipient whose address left the book is flagged, and the card message survives',
    moved.recipientState === 'address_missing' &&
      moved.html.includes('data-testid="repeat-address"') &&
      same.recipientState === 'ready' &&
      same.greeting !== null &&
      same.greeting.includes('Kessler'),
    `the line for the archived address asks where it should go instead; the line to ${same.recipient} carries "${same.greeting}" forward`);

  const confirmForm = formWith(review.body, reviewPath, 'data-testid="repeat-confirm"');
  const lineIds = lines.map((line) => line.lineId);
  const chosen: Record<string, string | string[]> = {
    lineId: lineIds,
    [`product-${same.lineId}`]: currentClassic.id,
    [`product-${mapped.lineId}`]: currentClassic.id,
    [`product-${gone.lineId}`]: '',
    [`product-${moved.lineId}`]: currentClassic.id,
    [`address-${moved.lineId}`]: '',
  };

  const noTicks = await family.submit(confirmForm, chosen);
  const blankChoice = await family.submit(confirmForm, {
    ...chosen,
    confirmReplacements: 'on',
    confirmRecipients: 'on',
  });
  const noAddress = await family.submit(confirmForm, {
    ...chosen,
    [`product-${gone.lineId}`]: currentDeluxe.id,
    confirmReplacements: 'on',
    confirmRecipients: 'on',
  });

  expect('S1d', 'Both ticks are required, an unmapped item must be decided, and a homeless line must be housed',
    flashOf(locationOf(noTicks, 'confirming without ticking'), 'problem').startsWith('Tick to say the swaps') &&
      flashOf(locationOf(blankChoice, 'confirming with an undecided line'), 'problem').includes('Heirloom Wine Basket') &&
      flashOf(locationOf(noAddress, 'confirming without an address'), 'problem').includes('address book') &&
      (await db.order.count({ where: { customerId: buyer.id, status: 'DRAFT' } })) === 0,
    `three refusals — "${flashOf(locationOf(noTicks, 'a'), 'problem')}", "${flashOf(locationOf(blankChoice, 'b'), 'problem')}", "${flashOf(locationOf(noAddress, 'c'), 'problem')}" — and still no draft`);

  const confirmed = await family.submit(confirmForm, {
    ...chosen,
    [`product-${gone.lineId}`]: currentDeluxe.id,
    [`address-${moved.lineId}`]: malka.id,
    confirmReplacements: 'on',
    confirmRecipients: 'on',
  });
  const confirmedTo = locationOf(confirmed, 'confirming the repeat');

  const draft = await db.order.findFirstOrThrow({
    where: { customerId: buyer.id, status: 'DRAFT', seasonId: current.id },
    include: { lines: true },
  });
  // The line that had nowhere to go: one box, no card message, and now pointed
  // at the address the customer picked on the review page.
  const rehoused = draft.lines.find(
    (line) => line.quantity === 1 && line.greetingMessage === null && line.customerAddressId === malka.id,
  );
  const cart = await family.get('/order');

  expect('S1e', 'Confirming builds one cart, at this year\u2019s prices, with the swaps and the new address on it',
    confirmedTo.startsWith('/order') &&
      draft.lines.length === 4 &&
      draft.lines.filter((line) => line.productId === currentClassic.id).length === 3 &&
      draft.lines.some((line) => line.productId === currentDeluxe.id) &&
      draft.lines.every((line) => line.unitPriceCents === (line.productId === currentDeluxe.id ? currentDeluxe.priceCents : currentClassic.priceCents)) &&
      draft.lines.some((line) => line.quantity === 2 && line.greetingMessage?.includes('Kessler') === true) &&
      rehoused?.recipientName === malka.recipientName &&
      cart.status === 200,
    `"${flashOf(confirmedTo, 'notice')}" — ${draft.draftReference} holds 4 lines re-priced from ${dollars(3200)} to ${dollars(currentClassic.priceCents)} each, the heirloom basket replaced by the ${currentDeluxe.name}, the card message intact, and the homeless line now going to ${malka.recipientName}`);

  const stranger = new Session(BASE_URL);
  await signInCustomer(stranger, `stranger-${stamp}@example.test`, 'Not Their Order');
  const peek = await stranger.get(reviewPath);
  const peekPost = await stranger.submit(confirmForm, {
    ...chosen,
    [`product-${gone.lineId}`]: currentDeluxe.id,
    [`address-${moved.lineId}`]: malka.id,
    confirmReplacements: 'on',
    confirmRecipients: 'on',
  });

  expect('S1f', 'Somebody else\u2019s order cannot be repeated, page or form',
    peek.body.includes('data-testid="repeat-blocked"') &&
      flashOf(locationOf(peekPost, 'repeating somebody else\u2019s order'), 'problem').includes('not one of yours') &&
      (await db.order.count({ where: { customerId: buyer.id, status: 'DRAFT' } })) === 1,
    `a signed-in stranger is told "That order is not one of yours." on the page and again when the form is replayed; ${buyer.fullName} still has exactly one cart`);

  // ------------------------------------------ S2 the office repeats to order
  const manager = new Session(BASE_URL);
  await signInStaff(manager, MANAGER_EMAIL);

  const deskPath = `/admin/orders/${source.id}`;
  const desk = await manager.get(deskPath);
  const repeatedAtCounter = await manager.submit(formWith(desk.body, deskPath, 'data-testid="order-repeat"'));
  const counterTo = locationOf(repeatedAtCounter, 'repeating an order at the counter');

  const till = await db.order.findFirstOrThrow({
    where: { customerId: buyer.id, status: 'DRAFT', posStaffUserId: { not: null } },
    include: { lines: true },
  });

  expect('S2a', 'Staff repeat one order onto their own till, with the dead item named rather than dropped quietly',
    counterTo.includes(buyer.id) &&
      till.lines.length === 3 &&
      flashOf(counterTo, 'notice').includes('Heirloom Wine Basket') &&
      till.id !== draft.id,
    `"${flashOf(counterTo, 'notice')}" — ${till.draftReference} opens on the counter with the three resolvable lines, separate from the cart ${buyer.fullName} built themselves`);

  const callBack = [
    await historicCustomer(`callback-${stamp}-a@example.test`, 'Adina Callback', lastYear, currentClassic),
    await historicCustomer(`callback-${stamp}-b@example.test`, 'Baila Callback', lastYear, currentClassic),
    await quietCustomer(`callback-${stamp}-c@example.test`, 'Chava Newcomer'),
  ];

  const search = `callback-${stamp}`;
  const directory = await manager.get(`${DIRECTORY}?q=${search}`);
  const bulk = await manager.submit(formWith(directory.body, DIRECTORY, 'data-testid="customers-bulk-repeat"'), {
    q: search,
    customerIds: callBack.map((customer) => customer.id),
  });
  const bulkTo = locationOf(bulk, 'repeating a list of customers');

  const bulkDrafts = await db.order.findMany({
    where: { customerId: { in: callBack.map((customer) => customer.id) }, status: 'DRAFT' },
  });

  expect('S2b', 'Bulk repeat drafts one cart per customer and reports the one it could not',
    flashOf(bulkTo, 'notice').startsWith('2 updated, 1 skipped') &&
      flashOf(bulkTo, 'notice').includes('Chava Newcomer') &&
      bulkDrafts.length === 2 &&
      bulkDrafts.every((row) => row.posStaffUserId !== null && row.seasonId === current.id),
    `"${flashOf(bulkTo, 'notice')}" — two tills opened for the customers with history, and the newcomer is reported by name instead of being given an empty order`);

  // -------------------------------------- S3 the year before the software
  const legacyEmail = `legacy-${stamp}@example.test`;
  const legacyInput = {
    reference: `OLD-${stamp}`,
    seasonYear: twoYearsAgo.year,
    customerEmail: legacyEmail,
    customerName: 'Tzvi Weiss',
    placedAt: new Date(Date.UTC(twoYearsAgo.year, 1, 20)),
    lines: [
      {
        productSlug: LEGACY_HAMPER,
        productName: 'Deluxe Hamper (old system)',
        category: 'Baskets',
        quantity: 1,
        unitPriceCents: 6800,
        recipientName: 'Tante Bruria',
        address: { line1: '77 Squankum Road', city: 'Lakewood', state: 'NJ', postalCode: '08701' },
        greetingMessage: 'With love from the Weiss family',
      },
      {
        productSlug: CLASSIC,
        productName: 'Classic Mishloach Manos',
        category: 'Boxes',
        quantity: 3,
        unitPriceCents: 3200,
        recipientName: 'Reb Yitzchok Weiss',
        address: { line1: '19 Cedarbridge Road', city: 'Lakewood', state: 'NJ', postalCode: '08701' },
      },
    ],
  };

  const firstImport = await importPriorYearOrder(legacyInput);
  const secondImport = await importPriorYearOrder(legacyInput);
  if (!firstImport.ok || !secondImport.ok) throw new Error('The prior-year import hook refused a well-formed order.');

  const importedLines = await db.orderLine.count({ where: { orderId: firstImport.value.id } });
  const importedAddresses = await db.customerAddress.count({
    where: { customer: { normalizedEmail: legacyEmail } },
  });

  expect('S3a', 'The year-one hook lands an old order once, however many times it is run',
    firstImport.value.id === secondImport.value.id &&
      importedLines === 2 &&
      importedAddresses === 2 &&
      (await db.order.count({ where: { importedOrderReference: legacyInput.reference } })) === 1,
    `${legacyInput.reference} imported twice is one ${twoYearsAgo.label} order with ${importedLines} lines and ${importedAddresses} recipients in the family's address book — the second run corrected the first rather than duplicating a family's history`);

  const mappingsPath = `${MAPPINGS}?season=${twoYearsAgo.year}`;
  const beforeMapping = await manager.get(mappingsPath);
  const rowsBefore = new Map(replacementRows(beforeMapping.body).map((row) => [row.slug, row]));

  const mappingForm = findForm(parseForms(beforeMapping.body, mappingsPath), {
    productId: (await product(twoYearsAgo.id, LEGACY_HAMPER)).id,
  });
  const savedMapping = await manager.submit(mappingForm, { replacedByProductId: currentDeluxe.id });

  const afterMapping = await manager.get(mappingsPath);
  const rowsAfter = new Map(replacementRows(afterMapping.body).map((row) => [row.slug, row]));

  expect('S3b', 'The mappings screen shows where every old item lands, chains included, and takes a new mapping by hand',
    rowsBefore.get(CLASSIC)?.resolution === 'same' &&
      rowsBefore.get(SAMPLER)?.resolution === 'mapped' &&
      rowsBefore.get(SAMPLER)?.html.includes('Followed 2 links') === true &&
      rowsBefore.get(LEGACY_HAMPER)?.resolution === 'unmapped' &&
      flashOf(locationOf(savedMapping, 'saving a mapping'), 'notice') === 'Mapping saved.' &&
      rowsAfter.get(LEGACY_HAMPER)?.resolution === 'mapped' &&
      rowsAfter.get(HEIRLOOM)?.resolution === 'unmapped',
    `${twoYearsAgo.label} → ${current.label}: the classic box is unchanged, the sampler tray is followed 2 links through ${MINI} to this year's box, and the imported hamper went from landing nowhere to landing on the ${currentDeluxe.name} the moment the office said so — the heirloom basket is still deliberately unmapped, so a repeat has to ask`);

  const weiss = new Session(BASE_URL);
  await signInCustomer(weiss, legacyEmail, 'Tzvi Weiss');
  const legacyReviewPath = `/account/orders/${firstImport.value.id}/repeat`;
  const legacyReview = await weiss.get(legacyReviewPath);
  const legacyLines = repeatLines(legacyReview.body);

  const legacyConfirm = await weiss.submit(
    formWith(legacyReview.body, legacyReviewPath, 'data-testid="repeat-confirm"'),
    {
      lineId: legacyLines.map((line) => line.lineId),
      [`product-${legacyLines[0].lineId}`]: currentDeluxe.id,
      [`product-${legacyLines[1].lineId}`]: currentClassic.id,
      confirmReplacements: 'on',
      confirmRecipients: 'on',
    },
  );

  const legacyDraft = await db.order.findFirstOrThrow({
    where: { customer: { normalizedEmail: legacyEmail }, status: 'DRAFT' },
    include: { lines: true },
  });
  const hamperNow = legacyDraft.lines.find((line) => line.productId === currentDeluxe.id);
  const boxesNow = legacyDraft.lines.find((line) => line.productId === currentClassic.id);

  expect('S3c', 'An imported order repeats like any other: mapped items, recipients, addresses and card messages all resolve',
    legacyReview.status === 200 &&
      legacyLines.length === 2 &&
      legacyLines[0].resolution === 'mapped' &&
      legacyLines[1].resolution === 'same' &&
      legacyLines.every((line) => line.recipientState === 'ready') &&
      legacyLines[0].greeting?.includes('Weiss family') === true &&
      locationOf(legacyConfirm, 'repeating an imported order').startsWith('/order') &&
      legacyDraft.lines.length === 2 &&
      hamperNow?.customerAddressId != null &&
      hamperNow?.recipientName === 'Tante Bruria' &&
      hamperNow?.greetingMessage?.includes('Weiss family') === true &&
      boxesNow?.quantity === 3,
    `the ${twoYearsAgo.year} hamper resolves to the ${currentDeluxe.name}, both recipients come back off the address book the import filled, "${legacyLines[0].greeting}" is still on Tante Bruria's card, and the three classic boxes stay three`);

  // ------------------------------------------------- S4 next Purim is set up
  const wizardPath = `${WIZARD}?copyFrom=${current.id}`;
  const wizardPage = await manager.get(wizardPath);
  // Everything the wizard offers to carry forward, ticked the way the office
  // would tick it. React orders the attributes as it likes, so the tag is found
  // by name and the value read out of it.
  const productIds = [...wizardPage.body.matchAll(/<input[^>]*name="productIds"[^>]*>/g)]
    .map((match) => /value="([^"]+)"/.exec(match[0])?.[1] ?? '')
    .filter((id) => id !== '');

  const created = await manager.submit(formWith(wizardPage.body, wizardPath, 'data-testid="wizard-create"'), {
    year: String(thisYear + 1),
    label: `Purim ${thisYear + 1}`,
    copyFromSeasonId: current.id,
    productIds,
    copyAddOns: 'on',
    linkReplacements: 'on',
  });
  const createdTo = locationOf(created, 'creating next season');

  const next = await db.season.findUniqueOrThrow({
    where: { year: thisYear + 1 },
    include: { products: { include: { inventory: true } }, addOns: true },
  });
  const linkedForward = await db.product.count({
    where: { seasonId: current.id, replacedBy: { seasonId: next.id } },
  });

  expect('S4a', 'The wizard copies next year\u2019s catalogue in, closed, with empty shelves and the replacement links already drawn',
    next.status === 'CLOSED' &&
      next.products.length === productIds.length &&
      next.products.every((row) => !row.tracksInventory || row.inventory?.onHand === 0) &&
      next.addOns.length > 0 &&
      linkedForward === productIds.length &&
      flashOf(createdTo, 'notice').includes('closed until you open it'),
    `"${flashOf(createdTo, 'notice')}" — ${next.label} has ${next.products.length} products at 0 on hand, ${next.addOns.length} add-ons, and ${linkedForward} of this season's products now point at their twin, so a repeat next year follows the chain`);

  const seasonsPage = await manager.get(SEASONS);

  // This season is promised open until the closing date the manager typed, so a
  // sweep that finds next season due has to leave both alone rather than close
  // the shop a month early.
  const promised = await manager.submit(
    formIn(seasonsPage.body, SEASONS, { seasonId: current.id }, `id="opensAt-${current.id}"`),
    { opensAt: wallClock(-30), closesAt: wallClock(30) },
  );
  const openedAt = wallClock(-2);
  const scheduled = await manager.submit(
    formIn((await manager.get(SEASONS)).body, SEASONS, { seasonId: next.id }, `id="opensAt-${next.id}"`),
    { opensAt: openedAt, closesAt: '' },
  );

  const held = await fetch(new URL('/api/cron/season-flip', BASE_URL), {
    method: 'POST',
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  const heldBody = (await held.json()) as { opened: number; closed: number };

  // Then the manager brings this season's closing forward, and the calendar
  // agrees with itself again.
  const closingNow = await manager.submit(
    formIn((await manager.get(SEASONS)).body, SEASONS, { seasonId: current.id }, `id="opensAt-${current.id}"`),
    { opensAt: wallClock(-30), closesAt: wallClock(-1) },
  );

  const unauthorized = await fetch(new URL('/api/cron/season-flip', BASE_URL), { method: 'POST' });
  const swept = await fetch(new URL('/api/cron/season-flip', BASE_URL), {
    method: 'POST',
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  const sweepBody = (await swept.json()) as { opened: number; closed: number };
  const cronRun = await db.cronRunLog.findFirstOrThrow({
    where: { jobName: 'season.scheduled-flip' },
    orderBy: { startedAt: 'desc' },
  });

  const afterSweep = await db.season.findMany({ where: { id: { in: [current.id, next.id] } } });
  const scheduledSummary = seasonCards((await manager.get(SEASONS)).body).find(
    (card) => card.year === String(next.year),
  );

  expect('S4b', 'A season opens on the clock, closes the one that was open, and only for a caller with the secret',
    flashOf(locationOf(promised, 'promising this season'), 'notice').startsWith('Schedule saved') &&
      flashOf(locationOf(scheduled, 'saving the schedule'), 'notice').startsWith('Schedule saved') &&
      heldBody.opened === 0 &&
      heldBody.closed === 0 &&
      flashOf(locationOf(closingNow, 'bringing the closing forward'), 'notice').startsWith('Schedule saved') &&
      unauthorized.status === 401 &&
      swept.status === 200 &&
      sweepBody.opened === 1 &&
      sweepBody.closed === 1 &&
      cronRun.status === 'SUCCEEDED' &&
      afterSweep.find((season) => season.id === next.id)?.status === 'OPEN' &&
      afterSweep.find((season) => season.id === current.id)?.status === 'CLOSED',
    `${next.label} was told to open at ${openedAt} ("${scheduledSummary?.schedule ?? ''}"); while ${current.label} was still promised open the sweep opened 0 and closed 0 rather than shutting it a month early; once its closing was brought forward, an unauthenticated POST to the flip job is refused (401) and the authorized one opened 1 and closed 1, leaving exactly one season open`);

  const reopenPage = await manager.get(SEASONS);
  const reopened = await manager.submit(
    formIn(reopenPage.body, SEASONS, { seasonId: current.id, to: 'OPEN' }, 'data-testid="season-flip"'),
  );
  const clearedSchedule = await manager.submit(
    formIn((await manager.get(SEASONS)).body, SEASONS, { seasonId: next.id }, `id="opensAt-${next.id}"`),
    { opensAt: '', closesAt: '' },
  );
  const clearedCurrent = await manager.submit(
    formIn((await manager.get(SEASONS)).body, SEASONS, { seasonId: current.id }, `id="opensAt-${current.id}"`),
    { opensAt: '', closesAt: '' },
  );

  const afterManual = await db.season.findMany({ where: { id: { in: [current.id, next.id] } } });

  expect('S4c', 'The manager\u2019s own switch does the same thing by hand, and clearing the dates hands the switch back',
    flashOf(locationOf(reopened, 'reopening this season'), 'notice').includes('taking orders') &&
      afterManual.find((season) => season.id === current.id)?.status === 'OPEN' &&
      afterManual.find((season) => season.id === next.id)?.status === 'CLOSED' &&
      flashOf(locationOf(clearedSchedule, 'clearing the schedule'), 'notice').startsWith('Schedule saved') &&
      flashOf(locationOf(clearedCurrent, 'clearing this season\u2019s schedule'), 'notice').startsWith('Schedule saved') &&
      (await db.season.findUniqueOrThrow({ where: { id: current.id } })).closesAt === null &&
      (await db.season.findUniqueOrThrow({ where: { id: next.id } })).opensAt === null,
    `"${flashOf(locationOf(reopened, 'a'), 'notice')}" — opening ${current.label} closed ${next.label} again, and ${next.label} is back to being flipped by hand`);

  const closing = await manager.submit(
    formIn((await manager.get(SEASONS)).body, SEASONS, { seasonId: current.id, to: 'CLOSED' }, 'data-testid="season-flip"'),
  );
  const shutOrder = await family.request('/order');
  const shutHome = await family.get('/');
  const archive = await family.get(`/archive/${lastYear.year}`);
  const archiveIndex = await family.get('/archive');
  await manager.submit(
    formIn((await manager.get(SEASONS)).body, SEASONS, { seasonId: current.id, to: 'OPEN' }, 'data-testid="season-flip"'),
  );

  expect('S4d', 'Off-season the shop stops taking orders and the archive stays readable',
    flashOf(locationOf(closing, 'closing the season'), 'notice').includes('archive stay open') &&
      shutOrder.status === 403 &&
      shutHome.status === 200 &&
      archive.status === 200 &&
      archive.body.includes('data-testid="archive-notice"') &&
      archiveIndex.status === 200 &&
      (await db.season.findUniqueOrThrow({ where: { id: current.id } })).status === 'OPEN',
    `with every season closed the order builder answers ${shutOrder.status}, while the home page and ${lastYear.label}'s collection still render — then ${current.label} is put back open for the next run`);

  const office = new Session(BASE_URL);
  await signInStaff(office, OFFICE_EMAIL);
  const officeSeasons = await office.get(SEASONS);
  const officeWizard = await office.get(WIZARD);
  const officeFlip = await office.submit(
    formIn((await manager.get(SEASONS)).body, SEASONS, { seasonId: current.id, to: 'CLOSED' }, 'data-testid="season-flip"'),
  );

  // An action that refuses answers with a fallback page, not with the 403 the
  // page itself gives, so what is checked is that it neither redirected with a
  // notice nor flipped the season.
  const officeFlipTook = (officeFlip.headers.get('location') ?? '').includes('notice=');

  expect('S4e', 'The season calendar is the manager\u2019s, on the page and on the form behind it',
    officeSeasons.status === 403 &&
      officeWizard.status === 403 &&
      !officeFlipTook &&
      (await db.season.findUniqueOrThrow({ where: { id: current.id } })).status === 'OPEN',
    `${OFFICE_EMAIL} is refused the calendar (${officeSeasons.status}) and the wizard (${officeWizard.status}); replaying the manager's own flip form from that session is refused (${officeFlip.status}, no flash) and the season is still open`);

  // ----------------------------------------------------- unit test citations
  const testRun = runTests(TEST_FILES, TEST_DATABASE_URL);
  const passedTests = new Set(testRun.passed);

  expectTest('P10-1', 'Replacement resolution and the price-smart suggestion are covered by unit tests', passedTests, [
    'a replacement chain resolves forward, and the same slug beats a stale mapping',
    'a mapping loop resolves to nothing rather than walking forever',
    'several retired boxes can fold into one survivor',
    'the price-smart suggestion stays inside the category it came from',
  ]);

  expectTest('P10-2', 'The repeat plan, its review page and the staff repeat are covered by unit tests', passedTests, [
    'a repeat with a discontinued line has to be decided before it becomes a draft',
    'staff repeat of a customer history copies what resolved and names what did not',
    'an imported prior-year order repeats with its products, recipients and greetings',
  ]);

  expectTest('P10-3', 'The season calendar and the wizard are covered by unit tests', passedTests, [
    'opening a season closes whichever one was open, and both flips are audited',
    'a schedule is read as the office wall clock and refuses to close before it opens',
    'the wizard copies a catalogue onto empty shelves and leaves the season closed',
    'a season opens on schedule, closes on schedule, and every run is logged',
    'a scheduled open closes whichever season was open, so the store has one catalogue',
    'every scheduled flip is audited the way the manager\u2019s own switch is',
    'a closing date the manager typed is not overruled by a season falling due',
  ]);

  record('P10-4', 'The P10 test files are green', testRun.failed.length === 0,
    `${testRun.passed.length} tests passed, ${testRun.failed.length} failed`);

  const ci = runCommand('npm', ['run', 'ci'], envWithoutDatabaseUrl());
  record('P10-5', 'Lint, typecheck, migration guard and the whole suite pass', ci.status === 0,
    ci.status === 0 ? 'npm run ci exited 0' : ci.output.trim().split('\n').slice(-6).join(' / '));

  run.write();
}

type World = {
  current: Season;
  lastYear: Season;
  twoYearsAgo: Season;
  currentClassic: Product;
  currentDeluxe: Product;
  buyer: { id: string; email: string; fullName: string };
  malka: { id: string; recipientName: string };
  source: Order;
};

/**
 * Two Purims of history, built straight into the database.
 *
 * This is the past, not the thing under test: the app has no screen for typing
 * in what happened in 2025, and the run needs a shape it could not sell itself
 * — a box that survived, one that was folded into something else two seasons
 * running, one that simply stopped, and a recipient who has since moved.
 */
async function buildHistory(): Promise<World> {
  await clearPreviousRun();

  const current = await db.season.update({
    where: { year: thisYear },
    data: { status: 'OPEN' },
  });
  const lastYear = await season(thisYear - 1);
  const twoYearsAgo = await season(thisYear - 2);

  const currentClassic = await product(current.id, CLASSIC);
  const currentDeluxe = await product(current.id, DELUXE);

  const mini = await retiredProduct(lastYear.id, {
    slug: MINI,
    name: 'Mini Sampler Tray',
    category: 'Boxes',
    priceCents: 2800,
    replacedByProductId: currentClassic.id,
  });
  const sampler = await retiredProduct(twoYearsAgo.id, {
    slug: SAMPLER,
    name: 'Family Sampler Tray',
    category: 'Boxes',
    priceCents: 2600,
    replacedByProductId: mini.id,
  });
  const heirloom = await retiredProduct(twoYearsAgo.id, {
    slug: HEIRLOOM,
    name: 'Heirloom Wine Basket',
    category: 'Baskets',
    priceCents: 5400,
    replacedByProductId: null,
  });
  const oldClassic = await retiredProduct(twoYearsAgo.id, {
    slug: CLASSIC,
    name: 'Classic Mishloach Manos',
    category: 'Boxes',
    priceCents: 3200,
    replacedByProductId: null,
  });

  const buyer = await db.customer.create({
    data: {
      email: `repeat-${stamp}@example.test`,
      normalizedEmail: `repeat-${stamp}@example.test`,
      fullName: 'Shaindy Kessler',
    },
  });

  const malka = await address(buyer.id, 'Malka Adler', '18 Ridge Road', 'Lakewood', 'NJ', '08701');
  const zev = await address(buyer.id, 'Zev Kessler', '204 Sunset Road', 'Lakewood', 'NJ', '08701');
  const rochel = await address(buyer.id, 'Bubby Rochel', '9 Ocean Avenue', 'Deal', 'NJ', '07723', true);

  const source = await historicOrder(twoYearsAgo, buyer.id, [
    { product: oldClassic, quantity: 2, to: malka, greeting: 'A freilichen Purim from the whole Kessler family' },
    { product: sampler, quantity: 1, to: zev },
    { product: heirloom, quantity: 1, to: zev },
    { product: oldClassic, quantity: 1, to: rochel },
  ]);

  return { current, lastYear, twoYearsAgo, currentClassic, currentDeluxe, buyer, malka, source };
}

/**
 * A run leaves next season and a handful of tills behind. Both are removed
 * rather than worked around, so the checks below mean the same thing on the
 * second run as on the first.
 */
async function clearPreviousRun(): Promise<void> {
  const strays = await db.season.findMany({
    where: { year: { gt: thisYear } },
    include: { _count: { select: { orders: true } } },
  });

  for (const stray of strays) {
    if (stray._count.orders === 0) await db.season.delete({ where: { id: stray.id } });
  }

  await db.orderLine.deleteMany({ where: { order: { status: 'DRAFT', posStaffUserId: { not: null } } } });
  await db.order.deleteMany({ where: { status: 'DRAFT', posStaffUserId: { not: null } } });

  // The mapping the last run drew by hand, so the screen starts from nothing
  // again. Everything else the run maps is upserted with its links each time.
  await db.product.updateMany({ where: { slug: LEGACY_HAMPER }, data: { replacedByProductId: null } });
}

function season(year: number): Promise<Season> {
  return db.season.upsert({
    where: { year },
    create: { year, label: `Purim ${year}`, status: 'CLOSED' },
    update: { status: 'CLOSED' },
  });
}

function product(seasonId: string, slug: string): Promise<Product> {
  return db.product.findUniqueOrThrow({ where: { seasonId_slug: { seasonId, slug } } });
}

function retiredProduct(
  seasonId: string,
  fields: {
    slug: string;
    name: string;
    category: string;
    priceCents: number;
    replacedByProductId: string | null;
  },
): Promise<Product> {
  const row = { ...fields, seasonId, isActive: false, tracksInventory: false };

  return db.product.upsert({
    where: { seasonId_slug: { seasonId, slug: fields.slug } },
    create: row,
    update: row,
  });
}

async function address(
  customerId: string,
  recipientName: string,
  line1: string,
  city: string,
  state: string,
  postalCode: string,
  isArchived = false,
): Promise<{ id: string; recipientName: string; line1: string; city: string; state: string; postalCode: string }> {
  const saved = await db.customerAddress.create({
    data: {
      customerId,
      recipientName,
      line1,
      city,
      state,
      postalCode,
      country: 'US',
      addressKey: normalizeAddressKey({ line1, line2: null, city, state, postalCode, country: 'US' }),
      isArchived,
    },
  });

  return saved;
}

type HistoricLine = {
  product: Product;
  quantity: number;
  to: { id: string; recipientName: string; line1: string; city: string; state: string; postalCode: string };
  greeting?: string;
};

async function historicOrder(
  target: Season,
  customerId: string,
  lines: HistoricLine[],
): Promise<Order> {
  const method = await db.fulfillmentMethod.findFirstOrThrow({
    where: { code: 'deliver' },
    select: { id: true },
  });
  const subtotalCents = lines.reduce((total, line) => total + line.product.priceCents * line.quantity, 0);
  const placedAt = new Date(Date.UTC(target.year, 1, 25));

  const order = await db.order.create({
    data: {
      seasonId: target.id,
      customerId,
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      amountPaidCents: subtotalCents,
      subtotalCents,
      totalCents: subtotalCents,
      placedAt,
      draftReference: createDraftReference(),
    },
  });

  // Spaced by a second each: the review page lists lines oldest first, and rows
  // written in the same millisecond would come back in whatever order the
  // database felt like.
  for (const [index, line] of lines.entries()) {
    await db.orderLine.create({
      data: {
        orderId: order.id,
        productId: line.product.id,
        quantity: line.quantity,
        productNameSnapshot: line.product.name,
        unitPriceCents: line.product.priceCents,
        lineTotalCents: line.product.priceCents * line.quantity,
        recipientName: line.to.recipientName,
        fulfillmentMethodId: method.id,
        customerAddressId: line.to.id,
        addressLine1: line.to.line1,
        addressCity: line.to.city,
        addressState: line.to.state,
        addressPostalCode: line.to.postalCode,
        addressCountry: 'US',
        greetingMessage: line.greeting ?? null,
        createdAt: new Date(placedAt.getTime() + index * 1000),
      },
    });
  }

  return order;
}

/** Somebody the office can call back: one real order in an earlier season. */
async function historicCustomer(
  email: string,
  fullName: string,
  target: Season,
  currentProduct: Product,
): Promise<{ id: string; fullName: string }> {
  const customer = await db.customer.create({
    data: { email, normalizedEmail: email, fullName },
  });
  const where = await address(customer.id, fullName, '31 Clifton Avenue', 'Lakewood', 'NJ', '08701');
  const carried =
    (await db.product.findUnique({
      where: { seasonId_slug: { seasonId: target.id, slug: currentProduct.slug } },
    })) ??
    (await retiredProduct(target.id, {
      slug: currentProduct.slug,
      name: currentProduct.name,
      category: currentProduct.category ?? 'Boxes',
      priceCents: 3200,
      replacedByProductId: null,
    }));

  await historicOrder(target, customer.id, [{ product: carried, quantity: 1, to: where }]);

  return customer;
}

/** Somebody with no history at all, so the sweep has something to report. */
function quietCustomer(email: string, fullName: string): Promise<{ id: string; fullName: string }> {
  return db.customer.create({ data: { email, normalizedEmail: email, fullName } });
}

/** A `datetime-local` value, N days from now, read as the office's own clock. */
function wallClock(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

async function signInCustomer(session: Session, email: string, fullName: string) {
  const page = await session.get('/account/sign-in');
  const response = await session.submit(parseForms(page.body, '/account/sign-in')[0], { email, fullName });
  if (response.status !== 303) throw new Error(`Customer sign-in for ${email} returned ${response.status}`);
}

async function signInStaff(session: Session, email: string) {
  session.clearCookies();
  const page = await session.get('/sign-in');
  const response = await session.submit(parseForms(page.body, '/sign-in')[0], { email });
  if (response.status !== 303) throw new Error(`Staff sign-in for ${email} returned ${response.status}`);
}

main()
  .catch((error) => {
    console.error(`\nSmoke run stopped: ${error instanceof Error ? error.message : error}`);
    run.write();
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
