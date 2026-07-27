import { readFileSync } from 'node:fs';

import { PrismaClient } from '@prisma/client';

import { DATABASE_URL, TEST_DATABASE_URL } from './db-server';
import { parseForms, Session, type ParsedForm } from './http-form';
import { envWithoutDatabaseUrl, runCommand, runTests, SmokeRun } from './smoke-harness';
import { cartLines, countOccurrences, dollars, formWith, noticeOf, redirectOf } from './smoke-p4-helpers';
import { flashOf, repeatLines } from './smoke-p10-helpers';
import {
  ALIAS_KLEIN_EMAIL,
  AMBIGUOUS_DONOR,
  CLEAN_ORDER_COUNT,
  CLEAN_ROW_COUNT,
  cleanLegacyFile,
  FORMULA_DONOR,
  messyLegacyFile,
  REFERENCE_BLOCK_SIZE,
} from './smoke-p12-fixtures';
import { HELP_TOURS } from '../src/lib/help/tours';
import { COUNTED_ORDER_STATUSES } from '../src/lib/reports/season-performance';

/**
 * Phase P12 smoke run: reports, exports, reconciliation, the year-one
 * migration, the dress rehearsal and the launch console — all of it over HTTP
 * against the running app.
 *
 * Two rules this run holds itself to. Every number a page claims is checked
 * against the same number computed straight from the database, so a report that
 * agrees with itself is not enough. And no row is written by hand: the legacy
 * history arrives through the import screens, the rehearsal order is bought on
 * the storefront and paid for on the hosted page, the demo season comes from
 * the test console, and every `db` call below is a read.
 *
 * The one exception is the scale fixture, which is a developer tool with its
 * own npm script and is run as one — `npm run fixtures:scale` — not reached
 * into. It runs after the rehearsal so the rehearsal is a small board with
 * three known boxes on it rather than five thousand.
 *
 * Against the EXPECTED table: S1 → S1a–S1c, S2 → S2a–S2e, S3 → S3a–S3f,
 * S4 → S4a, S5 → S5a–S5g, plus S5d2 (ten staff at once) and S5d3 (the help
 * centre) for the plan's own requirements that the table does not name.
 *
 * Expects `npm run dev` up on 3104 against the seeded database.
 */
const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3104';
const CRON_SECRET = process.env.CRON_SECRET ?? '';

const MANAGER_EMAIL = 'manager@tomchei.example';
const STAFF_EMAIL = 'staff@tomchei.example';

const CLASSIC = 'classic-mishloach-manos';

const REPORTS = '/admin/reports';
const MARGIN = '/admin/reports/margin';
const EXPORTS = '/admin/reports/exports';
const RECONCILIATION = '/admin/reports/payments';
const MIGRATION = '/admin/migration';
const CLEANUP = '/admin/migration/cleanup';
const TESTING = '/admin/settings/testing';
const HELP = '/admin/help';
const FULFILLMENT = '/admin/fulfillment';
const BOARD = `${FULFILLMENT}/packages`;
const ROUTES = '/admin/routes';
const PICKUP = '/admin/pickup';
const ORDER = '/order';

const RECONCILE_CRON = '/api/cron/payment-reconciliation';

/** Every job the deployment schedules, which is what `vercel.json` must hold. */
const CRON_PATHS = [
  '/api/cron/notification-sweep',
  '/api/cron/season-flip',
  '/api/cron/pickup-expiry',
  '/api/cron/payment-reminder',
  '/api/cron/payment-reconciliation',
  '/api/cron/email-log-purge',
];

/**
 * Two doors the offline geocoder puts twenty yards apart, which is what makes
 * the half-mile reroute rule fire on a van that is provably passing.
 */
const DOOR = { line1: '12 Forest Avenue', city: 'Lakewood', state: 'NJ', postalCode: '08701' };
const NEXT_DOOR = { ...DOOR, line1: '90 Forest Avenue' };

const TEST_FILES = ['tests/reports.test.ts', 'tests/migration.test.ts'];

/** What a page or a file is allowed to take at 1k orders / 5k packages. */
const SLOW_MS = 5_000;

const db = new PrismaClient({ datasourceUrl: DATABASE_URL });

const run = new SmokeRun('P12', [
  `Run at ${new Date().toISOString()} against ${BASE_URL} (web 3104, db 4104).`,
  '',
  'Every figure a screen claims is compared against the same figure computed',
  'from the database by this script, so a report agreeing with itself does not',
  'pass. The legacy history is uploaded through the migration screens, the',
  'rehearsal order is bought on the storefront and paid for on the hosted page,',
  'and the demo season is written by the test console: no row below was',
  'inserted by hand.',
  '',
  'EXPECTED smoke rows map onto these checks as: S1 → S1a–S1c, S2 → S2a–S2e,',
  'S3 → S3a–S3f, S4 → S4a, S5 → S5a–S5g. S5d2 (ten staff mutating at once) and',
  'S5d3 (the help centre) cover plan requirements the EXPECTED table does not',
  'name.',
]);

const record = run.record.bind(run);
const expect = run.expect.bind(run);
const expectTest = run.expectTest.bind(run);

let DELIVERY_DAY = '';

async function main() {
  DELIVERY_DAY = await firstDeliveryDay();

  const current = await db.season.findFirstOrThrow({
    where: { status: 'OPEN' },
    orderBy: { year: 'desc' },
  });
  const prior = await db.season.findFirstOrThrow({
    where: { year: { lt: current.year } },
    orderBy: { year: 'desc' },
  });

  const manager = new Session(BASE_URL);
  await signInStaff(manager, MANAGER_EMAIL);

  // A parcel bought and paid for before the margin view is read, because a
  // reconciliation of an empty season agrees with everything.
  await shipOneBoxForReal(manager, current.id);

  // ------------------------------------------------- S1 reports and the margin
  const reportsPage = await manager.get(REPORTS);
  const currentTotals = await seasonTotals(current.id);
  const priorTotals = await seasonTotals(prior.id);

  expect('S1a', 'Every season is reported side by side, and each figure matches the ledger',
    reportsPage.status === 200 &&
      matches(rowFor(reportsPage.body, current.year), currentTotals) &&
      matches(rowFor(reportsPage.body, prior.year), priorTotals),
    `${current.label}: ${currentTotals.orderCount} orders, ${currentTotals.customerCount} households, ${currentTotals.packageCount} boxes, ${dollars(currentTotals.revenueCents)} revenue / ${dollars(currentTotals.paidCents)} paid / ${dollars(currentTotals.outstandingCents)} owing; ${prior.label}: ${priorTotals.orderCount} orders, ${dollars(priorTotals.revenueCents)} — every cell read off the page and recomputed here`);

  const drilldown = await manager.get(`${REPORTS}/${current.id}`);
  const topProduct = await db.orderLine.groupBy({
    by: ['productNameSnapshot'],
    where: { order: { seasonId: current.id, status: { in: COUNTED_ORDER_STATUSES } } },
    _sum: { lineTotalCents: true },
    orderBy: { _sum: { lineTotalCents: 'desc' } },
    take: 1,
  });

  expect('S1b', 'The season drill-down names what sold, how it travelled and how it was paid for',
    drilldown.status === 200 &&
      ['products', 'methods', 'payments', 'statuses'].every((part) =>
        drilldown.body.includes(`data-testid="drilldown-${part}"`)) &&
      (topProduct.length === 0 ||
        drilldown.body.includes(dollars(topProduct[0]._sum.lineTotalCents ?? 0))),
    `${current.label} breaks into products, fulfillment methods, payment methods and order statuses${topProduct.length === 0 ? '' : `; the best seller "${topProduct[0].productNameSnapshot}" is printed at ${dollars(topProduct[0]._sum.lineTotalCents ?? 0)}`}`);

  const marginPage = await manager.get(`${MARGIN}?seasonId=${current.id}`);
  const parcels = await purchasedParcels(current.id);

  expect('S1c', 'The margin view adds up charged against paid, parcel by parcel',
    marginPage.status === 200 &&
      textAt(marginPage.body, 'margin-kept') === dollars(parcels.marginCents) &&
      marginPage.body.includes(dollars(parcels.chargedCents)) &&
      marginPage.body.includes(dollars(parcels.paidCents)),
    `${parcels.count} purchased parcels in ${current.label}: ${dollars(parcels.chargedCents)} charged, ${dollars(parcels.paidCents)} paid to carriers, ${dollars(parcels.marginCents)} kept — the page prints the same three`);

  // --------------------------------------------- S2 exports and reconciliation
  const exportsBefore = await db.exportLog.count();
  const yearEnd = await manager.request(`/api/admin/exports/year-end?seasonId=${current.id}`);
  const yearEndCsv = await yearEnd.text();
  const yearEndRows = csvLines(yearEndCsv);

  expect('S2a', 'A dataset downloads as a CSV with one row per counted order',
    yearEnd.status === 200 &&
      yearEnd.headers.get('content-type')?.startsWith('text/csv') === true &&
      (yearEnd.headers.get('content-disposition') ?? '').includes(`year-end-${current.year}.csv`) &&
      yearEndRows.length - 1 === currentTotals.orderCount,
    `year-end-${current.year}.csv came back as ${yearEnd.headers.get('content-type')} with ${yearEndRows.length - 1} data rows against ${currentTotals.orderCount} counted orders`);

  const anonymous = await fetch(new URL(`/api/admin/exports/year-end?seasonId=${current.id}`, BASE_URL));
  const staff = new Session(BASE_URL);
  await signInStaff(staff, STAFF_EMAIL);
  const withoutPermission = await staff.request(`/api/admin/exports/year-end?seasonId=${current.id}`);
  const staffReports = await staff.get(REPORTS);

  expect('S2b', 'The same file is refused to a stranger and to staff without the permission',
    anonymous.status === 401 && withoutPermission.status === 403 && staffReports.status === 403,
    `signed out → ${anonymous.status}, ${STAFF_EMAIL} → ${withoutPermission.status} on the file and ${staffReports.status} on the reports page`);

  const others = await Promise.all(
    ['deliveries', 'year-metrics', 'item-sales', 'lapsed-customers'].map((slug) =>
      manager.request(`/api/admin/exports/${slug}?seasonId=${current.id}`),
    ),
  );
  await Promise.all(others.map((response) => response.text()));

  const exportsAfter = await db.exportLog.count();
  const exportAudits = await db.auditEvent.count({ where: { action: 'report.exported' } });
  const historyPage = await manager.get(EXPORTS);

  expect('S2c', 'All five datasets export, and each download is on the record twice over',
    others.every((response) => response.status === 200) &&
      exportsAfter - exportsBefore === 5 &&
      exportAudits >= 5 &&
      historyPage.body.includes('data-testid="export-history"') &&
      historyPage.body.includes('data-testid="export-center"'),
    `deliveries, year-end, year-metrics, item-sales and lapsed-customers all answered 200; ExportLog grew by ${exportsAfter - exportsBefore} rows and ${exportAudits} report.exported audit events stand behind them, and the export centre lists the history`);

  // A gateway payment the ledger does not have. Made the way one is really
  // made: the money arrives, and somebody voids the payment row afterwards —
  // a mis-keyed correction, or the same charge entered twice. Stripe still
  // says it took the money.
  const orphan = await orphanedGatewayPayment(manager, current.id);

  const firstRun = await runReconciliation();
  const flagged = await db.paymentReconciliationFlag.findFirstOrThrow({
    where: { stripeSessionId: orphan.sessionId },
  });

  const secondRun = await runReconciliation();
  const flagsAfter = await db.paymentReconciliationFlag.count({
    where: { stripeSessionId: orphan.sessionId },
  });
  const stillOpen = await db.paymentReconciliationFlag.findUniqueOrThrow({ where: { id: flagged.id } });

  expect('S2d', 'An unrecorded gateway payment is flagged once, however often the sweep runs',
    flagged.kind === 'ORPHANED_INTENT' &&
      flagged.amountCents === orphan.amountCents &&
      firstRun.newFlagCount >= 1 &&
      secondRun.newFlagCount === 0 &&
      flagsAfter === 1 &&
      stillOpen.status === 'OPEN' &&
      stillOpen.firstSeenAt.getTime() === flagged.firstSeenAt.getTime() &&
      stillOpen.lastSeenAt.getTime() >= flagged.lastSeenAt.getTime(),
    `${orphan.how}. The first sweep checked ${firstRun.checkedCount} records and raised ${firstRun.newFlagCount} new flag for ${dollars(flagged.amountCents)}; the second checked ${secondRun.checkedCount} and raised ${secondRun.newFlagCount}, leaving ${flagsAfter} row still first-seen at ${flagged.firstSeenAt.toISOString()} and seen again since`);

  const noSecret = await fetch(new URL(RECONCILE_CRON, BASE_URL), { method: 'POST' });
  const wrongSecret = await fetch(new URL(RECONCILE_CRON, BASE_URL), {
    method: 'POST',
    headers: { authorization: 'Bearer not-the-secret' },
  });
  const scheduled = await fetch(new URL(RECONCILE_CRON, BASE_URL), {
    method: 'GET',
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  const registered = readVercelCrons();
  const reconciliationPage = await manager.get(RECONCILIATION);

  expect('S2e', 'Every scheduled job is registered, and every one of them is behind the secret',
    noSecret.status === 401 &&
      wrongSecret.status === 401 &&
      scheduled.status === 200 &&
      CRON_PATHS.every((path) => registered.some((cron) => cron.path === path)) &&
      registered.length === CRON_PATHS.length &&
      reconciliationPage.body.includes('data-testid="reconciliation-flags"') &&
      reconciliationPage.body.includes('data-testid="reconcile-run"'),
    `no header → ${noSecret.status}, wrong secret → ${wrongSecret.status}, the scheduler's own GET with the secret → ${scheduled.status}; vercel.json registers all ${registered.length}: ${registered.map((cron) => `${cron.path.split('/').pop()} (${cron.schedule})`).join(', ')}, and the sweep is also a button on the reconciliation screen`);

  // -------------------------------------------------------- S3 the migration
  const block = await nextReferenceBlock(prior.id);
  const clean = cleanLegacyFile(prior.year, block);
  const ordersBeforeDryRun = await db.order.count({ where: { seasonId: prior.id } });
  const customersBeforeDryRun = await db.customer.count();

  const cleanRunPath = await uploadLegacy(manager, prior.year, 'legacy-clean.csv', clean.csv);
  const cleanRunId = idOf(cleanRunPath);
  const staged = await db.legacyImportRun.findUniqueOrThrow({ where: { id: cleanRunId } });

  expect('S3a', 'The dry run reads the whole file and writes nothing but its own verdicts',
    staged.status === 'DRY_RUN' &&
      staged.rowCount === CLEAN_ROW_COUNT &&
      staged.validCount === CLEAN_ROW_COUNT &&
      staged.sourceTotalCents === clean.totalCents &&
      (await db.order.count({ where: { seasonId: prior.id } })) === ordersBeforeDryRun &&
      (await db.customer.count()) === customersBeforeDryRun,
    `${staged.rowCount} rows read and all ${staged.validCount} readable, worth ${dollars(staged.sourceTotalCents)} across ${staged.chunkCount} batches; ${prior.label} still has ${ordersBeforeDryRun} orders and the database still has ${customersBeforeDryRun} households`);

  const importedWhere = {
    seasonId: prior.id,
    importedOrderReference: { in: clean.references },
  };

  const firstPress = await commitLegacy(manager, cleanRunPath);
  const midway = await db.legacyImportRun.findUniqueOrThrow({ where: { id: cleanRunId } });
  const ordersMidway = await db.order.count({ where: importedWhere });

  const secondPress = await commitLegacy(manager, cleanRunPath);
  const finished = await db.legacyImportRun.findUniqueOrThrow({ where: { id: cleanRunId } });
  const ordersAfter = await db.order.count({ where: importedWhere });

  expect('S3b', 'The commit lands in whole batches and picks up exactly where it stopped',
    midway.status === 'COMMITTING' &&
      midway.committedChunkCount < midway.chunkCount &&
      ordersMidway === midway.committedChunkCount * 5 &&
      finished.status === 'COMMITTED' &&
      finished.ordersWritten === CLEAN_ORDER_COUNT &&
      finished.orderLinesWritten === CLEAN_ROW_COUNT &&
      ordersAfter === CLEAN_ORDER_COUNT,
    `first press: "${firstPress}" — ${midway.committedChunkCount}/${midway.chunkCount} batches and exactly ${ordersMidway} orders on the floor, no half order; second press: "${secondPress}" finishing at ${finished.ordersWritten} orders and ${finished.orderLinesWritten} lines`);

  const importedTotal = await db.order.aggregate({ where: importedWhere, _sum: { totalCents: true } });
  const lapsed = await manager.request(`/api/admin/exports/lapsed-customers?seasonId=${current.id}`);
  const lapsedCsv = await lapsed.text();

  expect('S3c', 'What the file said the orders were worth is what the database now holds, and a donor called "=SUM(1,2)" exports as text',
    finished.importedTotalCents === finished.sourceTotalCents &&
      finished.importedTotalCents === clean.totalCents &&
      (importedTotal._sum.totalCents ?? 0) === clean.totalCents &&
      lapsedCsv.includes(`"'${FORMULA_DONOR}"`),
    `source ${dollars(finished.sourceTotalCents)} against imported ${dollars(finished.importedTotalCents)}: a difference of ${dollars(finished.importedTotalCents - finished.sourceTotalCents)}, and the orders themselves add to ${dollars(importedTotal._sum.totalCents ?? 0)}. The volunteer who typed "${FORMULA_DONOR}" as a name leaves the building as "'${FORMULA_DONOR}", which Excel shows rather than runs`);

  const messy = messyLegacyFile(prior.year, block);
  const messyRunPath = await uploadLegacy(manager, prior.year, 'legacy-messy.csv', messy.csv);
  const messyRunId = idOf(messyRunPath);
  const messyRun = await db.legacyImportRun.findUniqueOrThrow({
    where: { id: messyRunId },
    include: { rows: true },
  });

  const repaired = messyRun.rows.filter((row) => row.orderReference === messy.repairedReference);
  const question = messyRun.rows.find((row) => row.status === 'NEEDS_MAPPING');
  const refusedCommit = await commitLegacy(manager, messyRunPath);

  expect('S3d', 'A messy file is sorted into readable, already-here, unreadable and asked-about',
    messyRun.validCount === 4 &&
      messyRun.duplicateCount === 1 &&
      messyRun.invalidCount === 2 &&
      messyRun.needsMappingCount === 1 &&
      repaired.length === 2 &&
      candidatesOf(question?.candidates).length >= 2 &&
      refusedCommit.includes('a customer chosen'),
    `"${messy.writtenReferences[0]}" and "${messy.writtenReferences[1]}" were both repaired to ${messy.repairedReference} and grouped as one order; ${messy.duplicateReference} was recognised as already imported; 2 rows are unreadable (${messyRun.rows.filter((row) => row.status === 'INVALID').map((row) => row.problem).join(' / ')}); one row cannot be placed and asks between the ${candidatesOf(question?.candidates).length} households called ${AMBIGUOUS_DONOR}, and the commit refuses while it does: "${refusedCommit}"`);

  const candidates = candidatesOf(question?.candidates);
  const runPage = await manager.get(messyRunPath);
  await manager.submit(
    formWith(runPage.body, messyRunPath, `Customer for line ${question?.lineNumber}`),
    { runId: messyRunId, lineNumber: String(question?.lineNumber ?? 0), customerId: candidates[0].id },
  );

  const duplicateBefore = await db.order.count({
    where: { seasonId: prior.id, importedOrderReference: messy.duplicateReference },
  });
  const messyCommit = await commitLegacy(manager, messyRunPath);
  const messyFinished = await db.legacyImportRun.findUniqueOrThrow({ where: { id: messyRunId } });
  const duplicateAfter = await db.order.count({
    where: { seasonId: prior.id, importedOrderReference: messy.duplicateReference },
  });
  const mappedOrder = await db.order.findFirstOrThrow({
    where: { seasonId: prior.id, importedOrderReference: messy.mappedReference },
  });

  expect('S3e', 'Answering the question lets the commit through, and the already-here order is not written twice',
    messyFinished.status === 'COMMITTED' &&
      messyFinished.needsMappingCount === 0 &&
      duplicateBefore === 1 &&
      duplicateAfter === 1 &&
      mappedOrder.customerId === candidates[0].id &&
      messyFinished.importedTotalCents === messy.totalCents,
    `"${messyCommit}" — order ${messy.duplicateReference} exists exactly ${duplicateAfter} time, the answered row landed on ${candidates[0].label}, and the run reconciles at ${dollars(messyFinished.importedTotalCents)} against ${dollars(messy.totalCents)} of readable file`);

  const scanFlash = await pressScan(manager);
  const openFlags = await db.addressCleanupFlag.findMany({ where: { status: 'OPEN' } });
  const noZip = openFlags.find((flag) => flag.kind === 'UNUSABLE_ADDRESS' && flag.note.startsWith('The Rov'));
  const twoKleins = openFlags.find((flag) => flag.note.startsWith(ALIAS_KLEIN_EMAIL));

  const aliasCustomer = await db.customer.findUniqueOrThrow({
    where: { normalizedEmail: ALIAS_KLEIN_EMAIL },
  });
  const aliasOrdersBefore = await db.order.count({ where: { customerId: aliasCustomer.id } });
  const mergeFlash = await resolveFlag(manager, twoKleins?.id ?? '', 'MERGED');
  const aliasOrdersAfter = await db.order.count({ where: { customerId: aliasCustomer.id } });
  const survivorOrders = await db.order.count({
    where: { customerId: twoKleins?.duplicateOfCustomerId ?? '' },
  });
  const keepFlash = await resolveFlag(manager, noZip?.id ?? '', 'KEPT');
  const keptAddress = await db.customerAddress.findUniqueOrThrow({ where: { id: noZip?.addressId ?? '' } });

  expect('S3f', 'The cleanup queue finds what the import could not fix, and a decision sticks',
    noZip !== undefined &&
      twoKleins !== undefined &&
      twoKleins.kind === 'DUPLICATE_CUSTOMER' &&
      aliasOrdersBefore === 1 &&
      aliasOrdersAfter === 0 &&
      survivorOrders >= 2 &&
      keptAddress.needsReview === false &&
      (await db.addressCleanupFlag.count({ where: { status: 'OPEN' } })) === openFlags.length - 2,
    `"${scanFlash}" — the ZIP-less address is listed as "${noZip?.note}" and the alias account as "${twoKleins?.note}". "${mergeFlash}" moved the alias's ${aliasOrdersBefore} order onto the household that already had one (now ${survivorOrders}); "${keepFlash}" left the broken address alone and took the review badge off it`);

  // ------------------------------------------- S4 repeating an imported order
  const legacyOrder = await db.order.findFirstOrThrow({
    where: { seasonId: prior.id, importedOrderReference: clean.references[1] },
    include: { customer: true, lines: true },
  });
  const currentProduct = await db.product.findFirstOrThrow({
    where: { seasonId: current.id, isActive: true },
  });

  const household = new Session(BASE_URL);
  await signInCustomer(household, legacyOrder.customer?.email ?? '', legacyOrder.customer?.fullName ?? '');
  const cleared = await cancelOpenBasket(household, legacyOrder.customerId ?? '', current.id);
  const reviewPath = `/account/orders/${legacyOrder.id}/repeat`;
  const review = await household.get(reviewPath);
  const lines = repeatLines(review.body);

  const confirmed = await household.submit(
    formWith(review.body, reviewPath, 'data-testid="repeat-confirm"'),
    {
      lineId: lines.map((line) => line.lineId),
      ...Object.fromEntries(lines.map((line) => [`product-${line.lineId}`, currentProduct.id])),
      confirmReplacements: 'on',
      confirmRecipients: 'on',
    },
  );
  const draft = await db.order.findFirst({
    where: { customerId: legacyOrder.customerId, status: 'DRAFT' },
    include: { lines: true },
  });

  expect('S4a', 'A household repeats the order this run imported, through the ordinary review page',
    review.status === 200 &&
      lines.length === legacyOrder.lines.length &&
      redirectOf(confirmed, 'repeating the imported order').startsWith(ORDER) &&
      draft !== null &&
      draft.lines.length === legacyOrder.lines.length &&
      draft.lines[0].recipientName === legacyOrder.lines[0].recipientName,
    `${legacyOrder.customer?.fullName} ${cleared}, opened last year's imported order #${legacyOrder.importedOrderReference}, was asked what each retired box is this year, and came away with a ${draft?.lines.length}-line cart for ${draft?.lines.map((line) => line.recipientName).join(', ')}`);

  // ------------------------------------------------- S5 the dress rehearsal
  const before = await seasonTotals(current.id);
  const rehearsal = await dressRehearsal(manager, current.id);
  const after = await seasonTotals(current.id);
  const rehearsedYearEnd = csvLines(
    await (await manager.request(`/api/admin/exports/year-end?seasonId=${current.id}`)).text(),
  );

  expect('S5a', 'A box bought on the web is paid for, printed, shipped, rerouted, delivered, collected and reported — with nothing typed into the database',
    rehearsal.paymentStatus === 'PAID' &&
      rehearsal.filedInBatch === 3 &&
      rehearsal.labelBought &&
      rehearsal.rerouteRefusedWithoutTick &&
      rehearsal.rerouted &&
      rehearsal.labelVoided &&
      rehearsal.deliveredStops === 2 &&
      rehearsal.pickupStage === 'PICKED_UP' &&
      after.orderCount === before.orderCount + 1 &&
      after.packageCount === before.packageCount + 3 &&
      after.revenueCents === before.revenueCents + rehearsal.totalCents &&
      rehearsedYearEnd.some((line) => line.startsWith(`${rehearsal.orderNumber},`)),
    `order #${rehearsal.orderNumber} for ${dollars(rehearsal.totalCents)} is ${rehearsal.paymentStatus}: three boxes assigned on the storefront, paid on the hosted page, ${rehearsal.filedInBatch} filed into tonight's batch. The shipping box got a ${rehearsal.carrier} label; the van passing ${DOOR.line1} was offered it and refused to take it without the tick ("${rehearsal.rerouteRefusal}"), then took it and cancelled the label ("${rehearsal.rerouteNotice}"). ${rehearsal.deliveredStops} stops were marked delivered, the pickup box is ${rehearsal.pickupStage}, and the season report grew by ${after.orderCount - before.orderCount} order, ${after.packageCount - before.packageCount} boxes and ${dollars(after.revenueCents - before.revenueCents)}, with the order on the year-end file`);

  const scale = runCommand('npm', ['run', 'fixtures:scale'], envWithoutDatabaseUrl());
  const scaleOrders = await db.order.count({ where: { draftReference: { startsWith: 'D-SCAL-' } } });
  const scalePackages = await db.package.count({ where: { greetingMessage: 'scale-fixture' } });

  expect('S5b', 'The rehearsal is then run against a real crunch: a thousand orders and five thousand boxes',
    scale.status === 0 && scaleOrders >= 1_000 && scalePackages >= 5_000,
    `npm run fixtures:scale wrote ${scaleOrders} orders and ${scalePackages} packages into ${current.label}`);

  const timings = [
    await timed('the reports page', () => manager.get(REPORTS)),
    await timed('the season drill-down', () => manager.get(`${REPORTS}/${current.id}`)),
    await timed('the margin view', () => manager.get(`${MARGIN}?seasonId=${current.id}`)),
    await timed('the package board', () => manager.get(BOARD)),
    await timed('the order list', () => manager.get('/admin/orders')),
    await timed('the deliveries export', () => asText(manager, `/api/admin/exports/deliveries?seasonId=${current.id}`)),
  ];

  const exportedRows = csvLines(timings[timings.length - 1].body).length - 1;

  expect('S5c', 'At that size every screen and the biggest file still answer quickly',
    timings.every((timing) => timing.status === 200 && timing.ms < SLOW_MS) &&
      exportedRows >= scalePackages,
    `${timings.map((timing) => `${timing.what} ${timing.ms}ms`).join(', ')} — all under ${SLOW_MS / 1000}s; the deliveries file streamed ${exportedRows} rows`);

  const nightly = await timed('the nightly print batch', async () => {
    const hub = await manager.get(FULFILLMENT);
    const response = await manager.submit(formWith(hub.body, FULFILLMENT, 'data-testid="build-batch"'));
    return { status: response.status === 303 ? 200 : response.status, body: redirectOf(response, 'building the nightly batch') };
  });
  const batch = await db.printBatch.findFirstOrThrow({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { groups: true } } },
  });

  expect('S5d', 'The nightly print batch takes the whole board in one pass',
    nightly.status === 200 && nightly.ms < 120_000 && batch.packageCount > 1_000,
    `filing ${batch.packageCount} boxes into ${batch._count.groups} print groups took ${Math.round(nightly.ms / 1000)}s`);

  const crowd = await tenStaffAtOnce(manager);

  expect('S5d2', 'Ten volunteers moving ten boxes at the same second all get through',
    crowd.accepted === crowd.attempted && crowd.moved === crowd.attempted,
    `${crowd.attempted} stage changes were posted in the same instant on a board of ${scalePackages} boxes: ${crowd.accepted} accepted, ${crowd.moved} boxes moved, none refused and no deadlock, in ${crowd.ms}ms — and two people pressing on one box from the same loaded screen left exactly one winner, the other told somebody had moved it`);

  const help = await manager.get(HELP);
  const officeHelp = await staff.get(HELP);
  const managerTours = countOccurrences(help.body, 'data-testid="help-tour"');
  const officeTours = countOccurrences(officeHelp.body, 'data-testid="help-tour"');

  expect('S5d3', 'The help centre walks every screen a reader can open, and none of the ones they cannot',
    help.status === 200 &&
      help.body.includes('data-testid="help-centre"') &&
      managerTours === HELP_TOURS.length &&
      officeHelp.status === 200 &&
      officeTours > 0 &&
      officeTours < managerTours &&
      !officeHelp.body.includes('data-tour="migration"') &&
      !officeHelp.body.includes('data-tour="rehearsal"') &&
      help.body.includes('data-testid="header-help"'),
    `the manager is offered all ${managerTours} tours, reached from the Help link in the header of every admin page; ${STAFF_EMAIL} is offered the ${officeTours} for screens they can open, and is not taught the migration or the rehearsal console`);

  const testModeOn = await toggleTestMode(manager);
  const storefront = await new Session(BASE_URL).get('/');
  const adminWithBanner = await manager.get(REPORTS);
  const bannerAudits = await db.auditEvent.count({ where: { action: 'settings.test_mode_changed' } });

  expect('S5e', 'Test mode says so on the storefront as loudly as in the office',
    storefront.body.includes('data-testid="test-mode-banner"') &&
      adminWithBanner.body.includes('data-testid="test-mode-banner"') &&
      bannerAudits >= 1,
    `"${testModeOn}" — the band is on the public homepage and on every admin page, and switching it is an audit row (${bannerAudits} so far)`);

  const ordersBeforeWipe = await db.order.count();
  const wipeFlash = await pressWipe(manager);
  const afterWipe = {
    orders: await db.order.count(),
    customers: await db.customer.count(),
    products: await db.product.count(),
    staff: await db.staffUser.count(),
    settings: await db.setting.count(),
  };

  const seeded = runCommand('npm', ['run', 'seed'], envWithoutDatabaseUrl());
  const afterSeed = {
    orders: await db.order.count(),
    customers: await db.customer.count(),
    season: await db.season.findFirst({ where: { status: 'OPEN' }, orderBy: { year: 'desc' } }),
  };

  expect('S5f', 'Wipe takes the orders and leaves the shop standing; the seed puts a clean season back',
    wipeFlash.includes('Wiped') &&
      afterWipe.orders === 0 &&
      afterWipe.customers === 0 &&
      afterWipe.products > 0 &&
      afterWipe.staff > 0 &&
      afterWipe.settings > 0 &&
      seeded.status === 0 &&
      afterSeed.orders > 0 &&
      afterSeed.season !== null,
    `"${wipeFlash}" cleared all ${ordersBeforeWipe} orders and every household while keeping ${afterWipe.products} products, ${afterWipe.staff} staff and ${afterWipe.settings} settings; npm run seed restored ${afterSeed.season?.label} with ${afterSeed.orders} orders and ${afterSeed.customers} households`);

  const testModeOff = await toggleTestMode(manager);
  const consoleLocked = await pressWipe(manager);
  const cleanStorefront = await new Session(BASE_URL).get('/');

  expect('S5g', 'With test mode off the banner goes and the destructive buttons refuse',
    !cleanStorefront.body.includes('data-testid="test-mode-banner"') &&
      consoleLocked.includes('test mode') &&
      (await db.order.count()) === afterSeed.orders,
    `"${testModeOff}" — the storefront is clean again and a replayed wipe is answered "${consoleLocked}", with all ${afterSeed.orders} seeded orders still there`);

  // --------------------------------------------------------- unit test citations
  const testRun = runTests(TEST_FILES, TEST_DATABASE_URL);
  const passedTests = new Set(testRun.passed);

  expectTest('P12-1', 'The CSV writer and the counting rule behind every report are covered by unit tests', passedTests, [
    'a value a spreadsheet would run as a formula is written as text',
    'a value with a comma, a quote or a newline survives the round trip',
    'money and dates are written in forms a spreadsheet adds up',
    'a season counts placed orders and ignores drafts and cancellations',
  ]);

  expectTest('P12-2', 'Legacy reading, chunking and the cleanup rules are covered by unit tests', passedTests, [
    'an order number written five ways is repaired to one',
    'a row that cannot be read says why, and does not stop the file',
    'a chunk is always a whole number of orders',
    'an address the post office could not use is flagged rather than dropped',
    'two spellings of one mailbox are found as one household',
  ]);

  record('P12-3', 'The P12 test files are green', testRun.failed.length === 0,
    `${testRun.passed.length} tests passed, ${testRun.failed.length} failed`);

  const lint = runCommand('npm', ['run', 'lint'], envWithoutDatabaseUrl());
  const types = runCommand('npm', ['run', 'typecheck'], envWithoutDatabaseUrl());
  record('P12-4', 'Lint and types are clean', lint.status === 0 && types.status === 0,
    `eslint exit ${lint.status}, tsc exit ${types.status}`);

  run.write();
}

// ---------------------------------------------------------------- the rehearsal

type Rehearsal = {
  orderNumber: number | null;
  totalCents: number;
  paymentStatus: string;
  filedInBatch: number;
  labelBought: boolean;
  carrier: string;
  rerouteRefusedWithoutTick: boolean;
  rerouteRefusal: string;
  rerouteNotice: string;
  rerouted: boolean;
  labelVoided: boolean;
  deliveredStops: number;
  pickupStage: string;
};

/**
 * The whole system in one order: a household buys three boxes on the
 * storefront, pays on the hosted page, and the office prints, ships, reroutes,
 * delivers and hands over the last one at the counter.
 *
 * Nothing here writes to the database. Every step is the screen a person would
 * use, which is the only way this proves anything about launch day.
 */
async function dressRehearsal(manager: Session, seasonId: string): Promise<Rehearsal> {
  const methods = await db.fulfillmentMethod.findMany({ where: { isActive: true } });
  const methodId = (code: string) => methods.find((method) => method.code === code)?.id ?? '';
  const pickupLocation = await db.pickupLocation.findFirstOrThrow();

  const email = `rehearsal-${Date.now()}@example.test`;
  const buyer = new Session(BASE_URL);
  await signInCustomer(buyer, email, 'Rehearsal Household');

  for (let box = 0; box < 3; box += 1) await addToCart(buyer, CLASSIC);
  const cart = cartLines((await buyer.get(ORDER)).body);
  if (cart.length < 3) throw new Error(`The rehearsal cart holds ${cart.length} boxes, not 3`);

  await assignBox(buyer, cart[0].id, {
    recipientName: 'Rivka Rehearsal',
    fulfillmentMethodId: methodId('deliver'),
    ...DOOR,
  });
  await assignBox(buyer, cart[1].id, {
    recipientName: 'Dov Nextdoor',
    fulfillmentMethodId: methodId('ship'),
    ...NEXT_DOOR,
  });
  await assignBox(buyer, cart[2].id, {
    recipientName: 'Rehearsal Household',
    fulfillmentMethodId: methodId('pickup'),
    pickupLocationId: pickupLocation.id,
  });

  await payOnTheHostedPage(buyer, 'Rehearsal Household', email);

  const order = await db.order.findFirstOrThrow({
    where: { seasonId, customer: { normalizedEmail: email } },
    include: { packages: { include: { fulfillmentMethod: true } } },
  });

  const shipBox = order.packages.find((box) => box.fulfillmentMethod.kind === 'SHIPPING');
  const pickupBox = order.packages.find((box) => box.fulfillmentMethod.kind === 'PICKUP');
  const deliveryBox = order.packages.find((box) => box.fulfillmentMethod.kind === 'DELIVERY');
  if (!shipBox || !pickupBox || !deliveryBox) {
    throw new Error(`The rehearsal order grouped into ${order.packages.length} boxes of the wrong kinds`);
  }

  // Tonight's paper, before anything moves.
  const hub = await manager.get(FULFILLMENT);
  redirectOf(await manager.submit(formWith(hub.body, FULFILLMENT, 'data-testid="build-batch"')), 'building the batch');
  const filedInBatch = await db.printBatchItem.count({ where: { orderId: order.id } });

  // The carrier takes the shipping box…
  const shipPath = `${BOARD}/${shipBox.id}`;
  await manager.submit(formWith((await manager.get(shipPath)).body, shipPath, 'data-testid="buy-label"'));
  const parcel = await db.shipmentBox.findFirstOrThrow({ where: { packageId: shipBox.id } });

  // …and then the van turns out to be going to the house next door anyway.
  const routePath = await buildRoute(manager, [deliveryBox.id]);
  const routeId = idOf(routePath);
  const suggestion = parseForms((await manager.get(routePath)).body, routePath).find(
    (form) => form.fields.packageId === shipBox.id,
  );
  if (!suggestion) throw new Error('The van was not offered the shipping box next door');

  const refusal = flashOf(redirectOf(await manager.submit(suggestion), 'a reroute with no tick'), 'problem');
  const stopsBefore = await db.routeStop.count({ where: { routeId } });
  const notice = flashOf(
    redirectOf(await manager.submit(suggestion, { confirmed: 'on' }), 'the confirmed reroute'),
    'notice',
  );

  const moved = await db.package.findUniqueOrThrow({
    where: { id: shipBox.id },
    include: { fulfillmentMethod: true, routeStop: true },
  });
  const voidedParcel = await db.shipmentBox.findUniqueOrThrow({ where: { id: parcel.id } });

  await startRoute(manager, routePath);
  const deliveredStops = await deliverEveryStop(manager, routePath, routeId);

  // The counter hands over the last box.
  const pickupPath = `${BOARD}/${pickupBox.id}`;
  for (const stage of ['PRINTED', 'PACKED']) {
    await manager.submit(formWith((await manager.get(pickupPath)).body, pickupPath, 'data-testid="advance-stage"'), { stage });
  }
  const stampForm = parseForms((await manager.get(PICKUP)).body, PICKUP).find(
    (form) => form.fields.packageId === pickupBox.id && form.html.includes('stamp-collected'),
  );
  if (!stampForm) throw new Error('The packed pickup box is not on the counter list');
  redirectOf(await manager.submit(stampForm), 'collecting the box');

  const collected = await db.package.findUniqueOrThrow({ where: { id: pickupBox.id } });
  const settled = await db.order.findUniqueOrThrow({ where: { id: order.id } });

  return {
    orderNumber: settled.orderNumber,
    totalCents: settled.totalCents,
    paymentStatus: settled.paymentStatus,
    filedInBatch,
    labelBought: parcel.status === 'PURCHASED',
    carrier: parcel.carrier ?? 'carrier',
    rerouteRefusedWithoutTick: refusal !== '' && stopsBefore === 1,
    rerouteRefusal: refusal,
    rerouteNotice: notice,
    rerouted: moved.fulfillmentMethod.kind === 'DELIVERY' && moved.routeStop?.routeId === routeId,
    labelVoided: voidedParcel.status === 'VOIDED',
    deliveredStops,
    pickupStage: collected.stage,
  };
}

/**
 * A household ships one box and the office buys the label for it.
 *
 * Bought the ordinary way, on the storefront and then on the board, so the
 * margin view has a real fee charged against a real carrier charge to
 * reconcile. Read against a season with no parcels in it, that page prints
 * three zeroes and agrees with itself perfectly.
 */
async function shipOneBoxForReal(manager: Session, seasonId: string): Promise<void> {
  const shipping = await db.fulfillmentMethod.findFirstOrThrow({
    where: { kind: 'SHIPPING', isActive: true },
  });

  const email = `margin-${Date.now()}@example.test`;
  const buyer = new Session(BASE_URL);
  await signInCustomer(buyer, email, 'Margin Household');

  await addToCart(buyer, CLASSIC);
  const [line] = cartLines((await buyer.get(ORDER)).body);
  await assignBox(buyer, line.id, {
    recipientName: 'Margin Recipient',
    fulfillmentMethodId: shipping.id,
    ...NEXT_DOOR,
  });
  await payOnTheHostedPage(buyer, 'Margin Household', email);

  const box = await db.package.findFirstOrThrow({
    where: { order: { seasonId, customer: { normalizedEmail: email } } },
  });
  const boxPath = `${BOARD}/${box.id}`;
  await manager.submit(formWith((await manager.get(boxPath)).body, boxPath, 'data-testid="buy-label"'));
}

async function addToCart(session: Session, slug: string): Promise<void> {
  const page = await session.get(ORDER);
  const form = parseForms(page.body, ORDER).find((candidate) => candidate.fields.slug === slug);
  if (!form) throw new Error(`No add form for ${slug} on the storefront builder`);

  redirectOf(await session.submit(form, { quantity: '1', 'option:Size': 'Standard' }), `adding ${slug}`);
}

async function assignBox(
  session: Session,
  lineId: string,
  values: { recipientName: string; fulfillmentMethodId: string } & Partial<{
    line1: string;
    city: string;
    state: string;
    postalCode: string;
    pickupLocationId: string;
  }>,
): Promise<void> {
  const path = `${ORDER}?assign=${lineId}&add=1`;
  const page = await session.get(path);

  redirectOf(
    await session.submit(formWith(page.body, path, 'data-testid="add-recipient-submit"'), {
      lineId,
      target: 'new',
      line1: '',
      line2: '',
      city: '',
      state: '',
      postalCode: '',
      phone: '',
      label: '',
      pickupLocationId: '',
      greetingMessage: 'A freilichen Purim',
      ...values,
    }),
    `assigning ${values.recipientName}`,
  );
}

/**
 * Checkout, including the day each delivery goes out (R-035), then the hosted
 * page's Pay button — which posts a signed event to the real webhook route.
 */
async function payOnTheHostedPage(session: Session, fullName: string, email: string): Promise<void> {
  const checkoutPath = `${ORDER}/checkout`;
  const answered = new Set<string>();

  for (;;) {
    const page = await session.get(checkoutPath);
    const form = parseForms(page.body, checkoutPath).find(
      (candidate) =>
        candidate.html.includes('data-testid="delivery-day-submit"') &&
        !answered.has(candidate.fields.recipientKey ?? ''),
    );
    if (!form) break;

    answered.add(form.fields.recipientKey ?? '');
    await session.submit(form, { deliveryDay: DELIVERY_DAY });
  }

  const checkout = await session.get(checkoutPath);
  const hostedPath = pathOf(
    redirectOf(
      await session.submit(formWith(checkout.body, checkoutPath, 'data-testid="checkout-pay"'), {
        fullName,
        email,
        phone: '',
      }),
      'going to pay',
    ),
  );

  const hosted = await session.get(hostedPath);
  redirectOf(
    await session.submit(formWith(hosted.body, hostedPath, 'data-testid="hosted-pay"')),
    'paying on the hosted page',
  );
}

async function buildRoute(manager: Session, packageIds: string[]): Promise<string> {
  const page = await manager.get(ROUTES);
  const location = redirectOf(
    await manager.submit(formWith(page.body, ROUTES, 'data-testid="build-route"'), {
      intent: 'build',
      label: `Rehearsal van ${Date.now()}`,
      deliveryDay: DELIVERY_DAY,
      packageIds,
    }),
    'building the route',
  );

  return pathOf(location);
}

async function startRoute(manager: Session, routePath: string): Promise<void> {
  const page = await manager.get(routePath);
  redirectOf(
    await manager.submit(formWith(page.body, routePath, 'data-testid="start-route"')),
    'starting the route',
  );
}

/** Every stop marked delivered from the office screen, one reload at a time. */
async function deliverEveryStop(manager: Session, routePath: string, routeId: string): Promise<number> {
  const stops = await db.routeStop.findMany({ where: { routeId }, select: { id: true } });
  if (stops.length === 0) throw new Error(`Route ${routeId} has no stops to deliver`);

  for (const stop of stops) {
    const page = await manager.get(routePath);
    const form = parseForms(page.body, routePath).find(
      (candidate) => candidate.fields.stopId === stop.id && candidate.html.includes('office-delivered'),
    );
    if (!form) throw new Error(`No Mark delivered button for stop ${stop.id}`);

    const landed = redirectOf(await manager.submit(form), 'marking a stop delivered');
    const problem = flashOf(landed, 'problem');
    if (problem !== '') throw new Error(`The office could not mark a stop delivered: ${problem}`);
  }

  return db.routeStop.count({ where: { routeId, status: 'DELIVERED' } });
}

type Crowd = { attempted: number; accepted: number; moved: number; ms: number };

/**
 * Ten volunteers pressing at the same second on a board of five thousand boxes
 * (G-024).
 *
 * Ten signed-in sessions, each on its own box, each holding a version stamp
 * taken before any of them pressed anything — which is a Tuesday evening in the
 * packing room, and the shape that finds a lock ordering problem. The boxes are
 * taken in order so they cluster onto neighbouring rows and the same few orders
 * rather than sitting in different corners of the table.
 *
 * The second half is the same box twice over: two people who both loaded it
 * before either moved it. One has to win and the other has to be told, because
 * "both said Printed and one of the moves vanished" is the failure this
 * transaction exists to prevent.
 */
async function tenStaffAtOnce(manager: Session): Promise<Crowd> {
  const boxes = await db.package.findMany({
    where: { greetingMessage: 'scale-fixture', stage: 'NEW' },
    orderBy: [{ orderId: 'asc' }, { groupingKey: 'asc' }],
    take: 10,
    select: { id: true },
  });
  if (boxes.length < 10) throw new Error(`Only ${boxes.length} unprinted scale boxes to move at once`);

  const sessions = await Promise.all(
    boxes.map(async (_, index) => {
      const session = new Session(BASE_URL);
      await signInStaff(session, index % 2 === 0 ? MANAGER_EMAIL : STAFF_EMAIL);
      return session;
    }),
  );

  const forms = await Promise.all(
    sessions.map(async (session, index) => {
      const path = `${BOARD}/${boxes[index].id}`;
      return formWith((await session.get(path)).body, path, 'data-testid="advance-stage"');
    }),
  );

  const started = Date.now();
  const responses = await Promise.all(
    forms.map((form, index) => sessions[index].submit(form, { stage: 'PRINTED' })),
  );
  const ms = Date.now() - started;

  const landings = responses.map((response, index) =>
    flashOf(redirectOf(response, `volunteer ${index + 1} marking a box printed`), 'problem'),
  );
  const refused = landings.filter((problem) => problem !== '');
  if (refused.length > 0) throw new Error(`${refused.length} of ten were refused: ${refused[0]}`);

  const moved = await db.package.count({
    where: { id: { in: boxes.map((box) => box.id) }, stage: 'PRINTED' },
  });

  await twoOnOneBox(manager, boxes[0].id);

  return { attempted: boxes.length, accepted: landings.length, moved, ms };
}

async function twoOnOneBox(manager: Session, packageId: string): Promise<void> {
  const path = `${BOARD}/${packageId}`;
  const stamped = formWith((await manager.get(path)).body, path, 'data-testid="advance-stage"');

  const [first, second] = await Promise.all([
    manager.submit(stamped, { stage: 'PACKED' }),
    manager.submit(stamped, { stage: 'PACKED' }),
  ]);

  const problems = [first, second]
    .map((response, index) => flashOf(redirectOf(response, `press ${index + 1} on one box`), 'problem'))
    .filter((problem) => problem !== '');

  if (problems.length !== 1) {
    throw new Error(
      `Two people moved one box from the same screen and ${problems.length} were told, not exactly one`,
    );
  }
  if (!/moved this package/i.test(problems[0])) {
    throw new Error(`The loser of a race was told "${problems[0]}", which does not name the cause`);
  }
}

// ------------------------------------------------------------------- readers

type SeasonFigures = {
  orderCount: number;
  customerCount: number;
  packageCount: number;
  revenueCents: number;
  paidCents: number;
  outstandingCents: number;
};

/** The season's figures, computed here rather than read off the page. */
async function seasonTotals(seasonId: string): Promise<SeasonFigures> {
  const counted = { seasonId, status: { in: COUNTED_ORDER_STATUSES } };

  const [money, customerCount, packageCount] = await Promise.all([
    db.order.aggregate({ where: counted, _count: { _all: true }, _sum: { totalCents: true, amountPaidCents: true } }),
    db.customer.count({ where: { orders: { some: counted } } }),
    db.package.count({ where: { order: counted } }),
  ]);

  const revenueCents = money._sum.totalCents ?? 0;
  const paidCents = money._sum.amountPaidCents ?? 0;

  return {
    orderCount: money._count._all,
    customerCount,
    packageCount,
    revenueCents,
    paidCents,
    outstandingCents: Math.max(revenueCents - paidCents, 0),
  };
}

async function purchasedParcels(seasonId: string) {
  const totals = await db.shipmentBox.aggregate({
    where: {
      status: 'PURCHASED',
      package: { order: { seasonId, status: { in: COUNTED_ORDER_STATUSES } } },
    },
    _sum: { customerPriceCents: true, carrierCostCents: true, marginCents: true },
    _count: { _all: true },
  });

  return {
    count: totals._count._all,
    chargedCents: totals._sum.customerPriceCents ?? 0,
    paidCents: totals._sum.carrierCostCents ?? 0,
    marginCents: totals._sum.marginCents ?? 0,
  };
}

function matches(row: string, totals: SeasonFigures): boolean {
  return [
    `>${totals.orderCount}<`,
    `>${totals.customerCount}<`,
    `>${totals.packageCount}<`,
    `>${dollars(totals.revenueCents)}<`,
    `>${dollars(totals.paidCents)}<`,
    `>${dollars(totals.outstandingCents)}<`,
  ].every((cell) => row.includes(cell));
}

function rowFor(html: string, year: number): string {
  const start = html.indexOf(`data-testid="season-row-${year}"`);
  return start === -1 ? '' : html.slice(start, start + 2_000).replaceAll('<!-- -->', '');
}

function textAt(html: string, testId: string): string {
  const flat = html.replaceAll('<!-- -->', '');
  const start = flat.indexOf(`data-testid="${testId}"`);
  if (start === -1) return '';

  return />([^<]*)</.exec(flat.slice(start))?.[1].trim() ?? '';
}

/** A CSV's lines, as the writer wrote them: CRLF between rows. */
function csvLines(csv: string): string[] {
  return csv.trimEnd().split('\r\n');
}

type Candidate = { id: string; label: string };

function candidatesOf(raw: unknown): Candidate[] {
  return Array.isArray(raw) ? (raw as Candidate[]) : [];
}

/** What the deployment will actually schedule, read from the file Vercel reads. */
function readVercelCrons(): { path: string; schedule: string }[] {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    crons?: { path: string; schedule: string }[];
  };

  return config.crons ?? [];
}

async function timed<T extends { status: number; body: string }>(
  what: string,
  work: () => Promise<T>,
): Promise<{ what: string; ms: number; status: number; body: string }> {
  const started = Date.now();
  const result = await work();

  return { what, ms: Date.now() - started, status: result.status, body: result.body };
}

async function asText(session: Session, path: string): Promise<{ status: number; body: string }> {
  const response = await session.request(path);
  return { status: response.status, body: await response.text() };
}

function pathOf(url: string): string {
  const parsed = new URL(url, BASE_URL);
  return `${parsed.pathname}${parsed.search}`;
}

/** The id a redirect ends at, without the flash message the redirect carries. */
function idOf(path: string): string {
  return new URL(path, BASE_URL).pathname.split('/').filter(Boolean).pop() ?? '';
}

/**
 * The order number this run's legacy files start at, above every reference the
 * season already holds. A fixed block would come back as nineteen duplicates
 * the second time this run is used against the same database, and the counts
 * below would all be measuring the duplicate detector instead of the import.
 */
async function nextReferenceBlock(seasonId: string): Promise<number> {
  const imported = await db.order.findMany({
    where: { seasonId, importedOrderReference: { not: null } },
    select: { importedOrderReference: true },
  });

  const highest = imported.reduce(
    (top, order) => Math.max(top, Number(order.importedOrderReference) || 0),
    10_000,
  );

  return highest + REFERENCE_BLOCK_SIZE;
}

async function firstDeliveryDay(): Promise<string> {
  const row = await db.setting.findUnique({ where: { key: 'delivery.dayChoices' } });
  const days = Array.isArray(row?.value) ? (row.value as string[]) : [];

  if (days.length === 0) throw new Error('The season has no delivery days configured.');
  return days[0];
}

// -------------------------------------------------------------- the screens

/**
 * "You already have an order on the go. Finish or cancel it" — a repeat is
 * refused into an open basket, which is right, and is also what a second run of
 * this smoke walks into: the basket the last run left behind. It is cancelled
 * from the customer's own order page, which is what the refusal tells them to
 * do.
 */
async function cancelOpenBasket(session: Session, customerId: string, seasonId: string): Promise<string> {
  const draft = await db.order.findFirst({
    where: { customerId, seasonId, status: 'DRAFT', posStaffUserId: null },
  });
  if (!draft) return 'had no basket open';

  const path = `/account/orders/${draft.id}`;
  const page = await session.get(path);
  const cancelled = await session.submit(formWith(page.body, path, 'data-testid="detail-cancel"'), {});

  return noticeOf(redirectOf(cancelled, 'cancelling the basket the last run left open'));
}

async function uploadLegacy(
  session: Session,
  seasonYear: number,
  fileName: string,
  csv: string,
): Promise<string> {
  const page = await session.get(MIGRATION);
  const response = await session.submit(
    formWith(page.body, MIGRATION, 'data-testid="migration-dry-run"'),
    {
      seasonYear: String(seasonYear),
      file: new File([csv], fileName, { type: 'text/csv' }),
    },
  );

  const location = redirectOf(response, `uploading ${fileName}`);
  if (!location.includes('/admin/migration/')) throw new Error(`The dry run was refused: ${location}`);

  return pathOf(location);
}

async function commitLegacy(session: Session, runPath: string): Promise<string> {
  const page = await session.get(runPath);
  const location = redirectOf(
    await session.submit(formWith(page.body, runPath, 'data-testid="run-commit"')),
    'committing the import',
  );

  return flashOf(location, 'notice') || flashOf(location, 'problem');
}

async function pressScan(session: Session): Promise<string> {
  const page = await session.get(CLEANUP);
  const response = await session.submit(formWith(page.body, CLEANUP, 'data-testid="cleanup-scan"'));

  return flashOf(redirectOf(response, 'scanning the address book'), 'notice');
}

async function resolveFlag(session: Session, flagId: string, decision: string): Promise<string> {
  const page = await session.get(CLEANUP);
  const form = parseForms(page.body, CLEANUP).find(
    (candidate) => candidate.fields.flagId === flagId && candidate.fields.decision === decision,
  );
  if (!form) throw new Error(`No ${decision} button for flag ${flagId}`);

  const location = redirectOf(await session.submit(form), `resolving ${flagId}`);
  return flashOf(location, 'notice') || flashOf(location, 'problem');
}

async function toggleTestMode(session: Session): Promise<string> {
  const page = await session.get(TESTING);
  const response = await session.submit(formWith(page.body, TESTING, 'data-testid="test-mode-toggle"'));

  return flashOf(redirectOf(response, 'switching test mode'), 'notice');
}

async function pressWipe(session: Session): Promise<string> {
  const page = await session.get(TESTING);
  const location = redirectOf(
    await session.submit(formWith(page.body, TESTING, 'data-testid="console-wipe"'), { confirmation: 'WIPE' }),
    'wiping',
  );

  return flashOf(location, 'notice') || flashOf(location, 'problem');
}

type ReconciliationBody = { checkedCount: number; flaggedCount: number; newFlagCount: number };

async function runReconciliation(): Promise<ReconciliationBody> {
  const response = await fetch(new URL(RECONCILE_CRON, BASE_URL), {
    method: 'POST',
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  if (!response.ok) throw new Error(`The reconciliation answered ${response.status}`);

  return (await response.json()) as ReconciliationBody;
}

/**
 * A gateway payment with nothing posted against it, arrived at the way the
 * office would really arrive at one: a card payment lands, and somebody voids
 * the payment row afterwards — a correction, a double entry, a mistake. The
 * money is still at Stripe. Nothing below writes a row: the sale is bought on
 * the storefront and the void is pressed on the payment desk.
 */
async function orphanedGatewayPayment(
  manager: Session,
  seasonId: string,
): Promise<{ sessionId: string; amountCents: number; how: string }> {
  const pickupLocation = await db.pickupLocation.findFirstOrThrow();
  const pickupMethod = await db.fulfillmentMethod.findFirstOrThrow({ where: { code: 'pickup' } });

  const email = `orphan-${Date.now()}@example.test`;
  const buyer = new Session(BASE_URL);
  await signInCustomer(buyer, email, 'Orphan Donor');

  await addToCart(buyer, CLASSIC);
  const [line] = cartLines((await buyer.get(ORDER)).body);
  await assignBox(buyer, line.id, {
    recipientName: 'Orphan Donor',
    fulfillmentMethodId: pickupMethod.id,
    pickupLocationId: pickupLocation.id,
  });
  await payOnTheHostedPage(buyer, 'Orphan Donor', email);

  const order = await db.order.findFirstOrThrow({
    where: { seasonId, customer: { normalizedEmail: email } },
    include: { payments: true },
  });
  const intent = await db.stripePaymentIntent.findFirstOrThrow({ where: { orderId: order.id } });
  const payment = order.payments.find((row) => row.method === 'STRIPE');
  if (!payment) throw new Error('The hosted page did not leave a card payment to void');

  const deskPath = `/admin/orders/${order.id}`;
  const desk = await manager.get(deskPath);
  redirectOf(
    await manager.submit(formWith(desk.body, deskPath, 'data-testid="payment-void"'), {
      reason: 'Entered twice at the desk',
    }),
    'voiding the card payment',
  );

  return {
    sessionId: intent.stripeSessionId,
    amountCents: intent.amountCents,
    how: `${dollars(intent.amountCents)} was taken on the hosted page and the payment row was then voided at the desk, so the gateway and the ledger disagree`,
  };
}

async function signInStaff(session: Session, email: string) {
  session.clearCookies();
  const page = await session.get('/sign-in');
  const response = await session.submit(parseForms(page.body, '/sign-in')[0], { email });
  if (response.status !== 303) throw new Error(`Staff sign-in for ${email} returned ${response.status}`);
}

async function signInCustomer(session: Session, email: string, fullName: string) {
  const page = await session.get('/account/sign-in');
  const form: ParsedForm = parseForms(page.body, '/account/sign-in')[0];
  const response = await session.submit(form, { email, fullName });
  if (response.status !== 303) throw new Error(`Customer sign-in for ${email} returned ${response.status}`);
}

main()
  .catch((error) => {
    console.error(`\nSmoke run stopped: ${error instanceof Error ? error.message : error}`);
    run.write();
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
