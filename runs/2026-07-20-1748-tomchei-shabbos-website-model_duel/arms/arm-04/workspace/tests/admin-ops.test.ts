import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import type { Order, Season } from '@prisma/client';

import { pageHref, pageInfo, readPageRequest, MAX_PAGE_SIZE } from '../src/lib/admin/list-query';
import { readDashboard, readTodayQueue } from '../src/lib/admin/dashboard';
import { CsvError, parseCsv } from '../src/lib/imports/csv';
import { commitImport, readBatch, stageImport } from '../src/lib/imports/import-service';
import { MAX_BULK_ITEMS, summarizeBulk } from '../src/lib/admin/bulk-report';
import { bulkChangeStatus, bulkRepeat } from '../src/lib/orders/bulk-actions';
import { listOrderDesk, readOrderDeskFilters } from '../src/lib/orders/order-desk';
import { repeatOrderAtCounter } from '../src/lib/orders/repeat-order';
import { createDraftReference } from '../src/lib/orders/draft-reference';
import { listCustomerDirectory } from '../src/lib/customers';
import {
  createCustomer,
  createFulfillmentMethod,
  createProduct,
  createSeason,
  createStaffContext,
  db,
} from './fixtures';

/**
 * The operations hub on the morning of Purim: a thousand orders behind the
 * search box, two members of staff sweeping the same list, and somebody
 * uploading last year's spreadsheet while they do it.
 *
 * These tests are about what those three have in common — every read is
 * bounded, every bulk write reports exactly what it did, and an import either
 * lands whole or not at all.
 */

after(() => db.$disconnect());

const MANAGER = ['orders.view', 'orders.manage', 'imports.manage'] as const;

async function placedOrder(input: {
  season: Season;
  customerId: string;
  orderNumber: number;
  totalCents?: number;
  amountPaidCents?: number;
  status?: 'PLACED' | 'IN_FULFILLMENT' | 'COMPLETED';
}): Promise<Order> {
  const totalCents = input.totalCents ?? 3600;
  const amountPaidCents = input.amountPaidCents ?? 0;

  return db.order.create({
    data: {
      seasonId: input.season.id,
      customerId: input.customerId,
      draftReference: createDraftReference(),
      orderNumber: input.orderNumber,
      status: input.status ?? 'PLACED',
      placedAt: new Date(),
      subtotalCents: totalCents,
      totalCents,
      amountPaidCents,
      paymentStatus: amountPaidCents >= totalCents ? 'PAID' : 'UNPAID',
    },
  });
}

test('a page request is clamped, and the page it describes adds up', () => {
  const asked = readPageRequest({ page: '3', size: '10' });
  assert.deepEqual(asked, { page: 3, pageSize: 10, skip: 20, take: 10 });

  // Anything a URL can carry: a word, a negative, a number big enough to make
  // the database read the whole table.
  assert.equal(readPageRequest({ page: 'banana' }).page, 1);
  assert.equal(readPageRequest({ page: '-4' }).page, 1);
  assert.equal(readPageRequest({ size: '100000' }).pageSize, MAX_PAGE_SIZE);
  assert.equal(readPageRequest({ size: '0' }).pageSize, 1);

  const middle = pageInfo(asked, 1_000);
  assert.deepEqual(
    { first: middle.firstRow, last: middle.lastRow, pages: middle.pageCount, next: middle.nextPage },
    { first: 21, last: 30, pages: 100, next: 4 },
  );

  const empty = pageInfo(readPageRequest({}), 0);
  assert.deepEqual(
    { first: empty.firstRow, last: empty.lastRow, pages: empty.pageCount, next: empty.nextPage },
    { first: 0, last: 0, pages: 1, next: null },
  );
});

test('page links keep the search that produced them, and page 1 stays clean', () => {
  const query = { q: 'klein', status: 'PLACED', size: '25' };

  assert.equal(pageHref('/admin/orders', query, 1), '/admin/orders?q=klein&status=PLACED&size=25');
  assert.equal(
    pageHref('/admin/orders', query, 4),
    '/admin/orders?q=klein&status=PLACED&size=25&page=4',
  );
});

test('the desk finds an order by its number, its reference, and the customer', async () => {
  const season = await createSeason();
  const customer = await createCustomer('Miriam Klein');
  const other = await createCustomer('Someone Else');

  const wanted = await placedOrder({ season, customerId: customer.id, orderNumber: 4021 });
  await placedOrder({ season, customerId: other.id, orderNumber: 4022 });

  const request = readPageRequest({});
  const byNumber = await listOrderDesk(
    readOrderDeskFilters({ q: '#4021', season: season.id }),
    request,
  );
  const byReference = await listOrderDesk(
    readOrderDeskFilters({ q: wanted.draftReference.toLowerCase(), season: season.id }),
    request,
  );
  const byName = await listOrderDesk(
    readOrderDeskFilters({ q: 'klein', season: season.id }),
    request,
  );
  const byEmail = await listOrderDesk(
    readOrderDeskFilters({ q: customer.email.toUpperCase(), season: season.id }),
    request,
  );

  for (const found of [byNumber, byReference, byName, byEmail]) {
    assert.deepEqual(
      found.rows.map((row) => row.id),
      [wanted.id],
    );
  }

  const everything = await listOrderDesk(readOrderDeskFilters({ season: season.id }), request);
  assert.equal(everything.page.totalCount, 2);
});

test('carts are off the desk unless somebody asks for them', async () => {
  const season = await createSeason();
  const customer = await createCustomer();

  await placedOrder({ season, customerId: customer.id, orderNumber: 5001 });
  await db.order.create({
    data: { seasonId: season.id, customerId: customer.id, draftReference: createDraftReference() },
  });
  await db.order.create({
    data: {
      seasonId: season.id,
      customerId: customer.id,
      draftReference: createDraftReference(),
      status: 'DISCARDED',
      discardedAt: new Date(),
    },
  });

  const request = readPageRequest({});
  const normal = await listOrderDesk(readOrderDeskFilters({ season: season.id }), request);
  const drafts = await listOrderDesk(
    readOrderDeskFilters({ season: season.id, status: 'DRAFT' }),
    request,
  );

  assert.equal(normal.page.totalCount, 1);
  assert.equal(drafts.page.totalCount, 1);
  assert.equal(drafts.rows[0].orderNumber, null);
});

test('paging a long list shows every row exactly once', async () => {
  const season = await createSeason();
  const customer = await createCustomer('Paging Test');

  for (let index = 0; index < 25; index += 1) {
    await placedOrder({ season, customerId: customer.id, orderNumber: 6000 + index });
  }

  const filters = readOrderDeskFilters({ season: season.id });
  const seen: string[] = [];

  for (const page of [1, 2, 3]) {
    const read = await listOrderDesk(filters, readPageRequest({ page: String(page), size: '10' }));
    seen.push(...read.rows.map((row) => row.id));
  }

  assert.equal(seen.length, 25);
  assert.equal(new Set(seen).size, 25);
});

test('two people sweeping the same list: the second is told what the first already did', async () => {
  const season = await createSeason();
  const staff = await createStaffContext([...MANAGER]);
  const colleague = await createStaffContext([...MANAGER]);
  const customer = await createCustomer();

  const first = await placedOrder({ season, customerId: customer.id, orderNumber: 7001 });
  const second = await placedOrder({ season, customerId: customer.id, orderNumber: 7002 });
  const paid = await placedOrder({
    season,
    customerId: customer.id,
    orderNumber: 7003,
    amountPaidCents: 3600,
  });
  const gone = '00000000-0000-4000-8000-000000000000';

  const mine = await bulkChangeStatus(staff, [first.id, second.id], 'IN_FULFILLMENT');
  assert.equal(mine.applied, 2);
  assert.equal(mine.conflicts, 0);

  // One id ties the sweep's per-order audit rows together, so "what did that
  // batch touch" is one query however the batch was run.
  const sweepRows = await db.auditEvent.findMany({
    where: { action: 'order.status_changed', detail: { path: ['batchId'], equals: mine.batchId } },
  });
  assert.deepEqual(
    sweepRows.map((row) => row.entityId).sort(),
    [first.id, second.id].sort(),
  );

  // The colleague's screen still lists them as placed, so their batch repeats
  // the move that already happened, adds one that holds money and one that has
  // been deleted since the page was drawn.
  const theirs = await bulkChangeStatus(
    colleague,
    [second.id, first.id, paid.id, gone],
    'CANCELLED',
  );

  assert.deepEqual(
    theirs.records.map((record) => `${record.label}:${record.outcome}`),
    [`#007001:applied`, `#007002:applied`, `#007003:skipped`, `~${gone.slice(0, 8)}:skipped`],
  );
  assert.equal(theirs.applied, 2);
  assert.equal(theirs.skipped, 2);
  assert.equal(
    theirs.records.find((record) => record.label === '#007003')?.detail,
    'Holds money. Refund it on the order first.',
  );
  assert.equal(summarizeBulk(theirs), '2 updated, 2 skipped');

  // Deterministic: the same batch in a different order reads the same way.
  const again = await bulkChangeStatus(colleague, [gone, paid.id, first.id, second.id], 'CANCELLED');
  assert.deepEqual(
    again.records.map((record) => record.label),
    theirs.records.map((record) => record.label),
  );
  assert.equal(again.applied, 0);
  assert.equal(again.conflicts, 2);
});

test('a bulk batch is bounded, and says how much it left alone', async () => {
  const staff = await createStaffContext([...MANAGER]);
  const ids = Array.from({ length: MAX_BULK_ITEMS + 5 }, (_, index) =>
    `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  );

  const report = await bulkChangeStatus(staff, [...ids, ids[0]], 'COMPLETED');

  assert.equal(report.records.length, MAX_BULK_ITEMS);
  assert.equal(report.droppedCount, 5);
  assert.equal(report.requested, MAX_BULK_ITEMS + 5);
  assert.match(summarizeBulk(report), /over the 100 limit/);
});

test('a repeat copies last season at this season prices, and names what is gone', async () => {
  const lastYear = await createSeason('CLOSED');
  const thisYear = await createSeason();
  const staff = await createStaffContext([...MANAGER]);
  const customer = await createCustomer('Repeat Buyer');
  const method = await createFulfillmentMethod('PICKUP');

  const oldProduct = await createProduct(lastYear, { priceCents: 3000 });
  const discontinued = await createProduct(lastYear, { priceCents: 1000 });
  const thisYearsProduct = await db.product.create({
    data: {
      seasonId: thisYear.id,
      slug: oldProduct.slug,
      name: 'Classic box',
      priceCents: 3600,
    },
  });

  const source = await db.order.create({
    data: {
      seasonId: lastYear.id,
      customerId: customer.id,
      draftReference: createDraftReference(),
      orderNumber: 9001,
      status: 'COMPLETED',
      placedAt: new Date(),
      lines: {
        create: [oldProduct, discontinued].map((product) => ({
          productId: product.id,
          quantity: 2,
          productNameSnapshot: product.name,
          unitPriceCents: product.priceCents,
          lineTotalCents: product.priceCents * 2,
          recipientName: 'Aunt Chana',
          fulfillmentMethodId: method.id,
          greetingMessage: 'Same as always',
        })),
      },
    },
  });

  const repeated = await repeatOrderAtCounter(staff, source.id, thisYear.id);
  assert.equal(repeated.ok, true);
  if (!repeated.ok) return;

  assert.equal(repeated.value.copiedLines, 1);
  assert.deepEqual(repeated.value.skippedLines, [discontinued.name]);

  const copied = await db.orderLine.findMany({ where: { orderId: repeated.value.draftId } });
  assert.equal(copied.length, 1);
  assert.equal(copied[0].productId, thisYearsProduct.id);
  assert.equal(copied[0].unitPriceCents, 3600);
  assert.equal(copied[0].lineTotalCents, 7200);
  assert.equal(copied[0].recipientName, 'Aunt Chana');

  const draft = await db.order.findUniqueOrThrow({ where: { id: repeated.value.draftId } });
  assert.equal(draft.posStaffUserId, staff.acting.id);
  assert.equal(draft.status, 'DRAFT');

  const audited = await db.auditEvent.findFirst({
    where: { action: 'order.repeated', entityId: draft.id },
  });
  assert.ok(audited);

  // The same till cannot hold two carts for one customer.
  const twice = await repeatOrderAtCounter(staff, source.id, thisYear.id);
  assert.equal(twice.ok, false);

  const batch = await bulkRepeat(staff, [source.id], thisYear.id);
  assert.equal(batch.conflicts, 1);
  assert.match(batch.records[0].detail, /already has/);
});

test('the dashboard counts the season being run, and the queue shows the work', async () => {
  const season = await createSeason();
  const staff = await createStaffContext([...MANAGER]);
  const customer = await createCustomer('Queue Customer');

  const owing = await placedOrder({
    season,
    customerId: customer.id,
    orderNumber: 8001,
    totalCents: 5000,
  });
  await placedOrder({
    season,
    customerId: customer.id,
    orderNumber: 8002,
    totalCents: 4000,
    amountPaidCents: 4000,
  });
  await db.order.create({
    data: {
      seasonId: season.id,
      customerId: customer.id,
      draftReference: createDraftReference(),
      posStaffUserId: staff.acting.id,
    },
  });

  const kpis = await readDashboard(season.id, 'Purim 3001');
  assert.equal(kpis.ordersPlaced, 2);
  assert.equal(kpis.itemsSoldCents, 9000);
  assert.equal(kpis.outstandingCents, 5000);
  assert.equal(kpis.unpaidOrders, 1);

  const queue = await readTodayQueue(season.id);
  assert.deepEqual(
    queue.awaitingPayment.map((row) => row.id),
    [owing.id],
  );
  assert.equal(queue.readyToPack.length, 1);
  assert.equal(queue.openTills.length, 1);
  assert.equal(queue.openTills[0].customerName, 'Queue Customer');
});

test('the customer directory pages, searches and counts only real orders', async () => {
  const season = await createSeason();
  // Stamped, because the search is by name and this file is run more than once
  // against the same database.
  const name = `Directory Person ${Date.now().toString(36)}`;
  const customer = await createCustomer(name);

  await placedOrder({ season, customerId: customer.id, orderNumber: 8500 });
  await db.order.create({
    data: { seasonId: season.id, customerId: customer.id, draftReference: createDraftReference() },
  });

  const found = await listCustomerDirectory(name.toLowerCase(), readPageRequest({}));
  assert.equal(found.rows.length, 1);
  assert.equal(found.rows[0]._count.orders, 1);

  const byEmail = await listCustomerDirectory(customer.email, readPageRequest({}));
  assert.deepEqual(
    byEmail.rows.map((row) => row.id),
    [customer.id],
  );
});

test('the CSV reader handles quotes, commas and either line ending', () => {
  const table = parseCsv(
    'Full Name,Email,Phone\r\n"Klein, Miriam",miriam@example.test,732-555-0101\n"He said ""hi""",two@example.test,\n\n',
  );

  assert.deepEqual(table.headers, ['fullname', 'email', 'phone']);
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0].values.fullname, 'Klein, Miriam');
  assert.equal(table.rows[0].lineNumber, 2);
  assert.equal(table.rows[1].values.fullname, 'He said "hi"');
  assert.equal(table.rows[1].values.phone, '');

  assert.throws(() => parseCsv(''), CsvError);
  assert.throws(() => parseCsv('name,,email\na,b,c'), CsvError);
  assert.throws(() => parseCsv('email,email\na,b'), CsvError);
  assert.throws(() => parseCsv('name\n"unclosed'), CsvError);
});

test('an import is staged with a verdict per row and written all at once', async () => {
  const staff = await createStaffContext([...MANAGER]);
  const existing = await createCustomer('Old Spelling');
  const stamp = Date.now().toString(36);
  // A phone already on file is read as the same household, which is the point of
  // the rule and would quietly change this row's verdict on a second run.
  const digits = String(Date.now()).slice(-7);
  const phone = `732-${digits.slice(0, 3)}-${digits.slice(3)}`;

  const csv = [
    'fullName,email,phone',
    `Corrected Spelling,${existing.email},`,
    `New Person,new-${stamp}@example.test,${phone}`,
    `Another New,another-${stamp}@example.test,`,
    `Twice In File,new-${stamp}@example.test,`,
    'No Address,not-an-email,',
  ].join('\n');

  const staged = await stageImport(staff, {
    kind: 'CUSTOMERS',
    fileName: 'members.csv',
    content: csv,
    seasonId: null,
  });

  assert.equal(staged.ok, true);
  if (!staged.ok) return;

  assert.deepEqual(
    staged.value.rows.map((row) => row.status),
    ['DUPLICATE', 'VALID', 'VALID', 'INVALID', 'INVALID'],
  );
  assert.equal(staged.value.validCount, 2);
  assert.equal(staged.value.duplicateCount, 1);
  assert.equal(staged.value.invalidCount, 2);

  // Nothing has been written: the preview is a preview.
  assert.equal(await db.customer.count({ where: { email: `new-${stamp}@example.test` } }), 0);
  assert.equal((await db.customer.findUniqueOrThrow({ where: { id: existing.id } })).fullName, 'Old Spelling');

  const refused = await commitImport(staff, staged.value.id);
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.match(refused.publicMessage, /cannot be imported/);
  assert.equal(await db.customer.count({ where: { email: `new-${stamp}@example.test` } }), 0);

  const fixed = await stageImport(staff, {
    kind: 'CUSTOMERS',
    fileName: 'members-fixed.csv',
    content: [
      'fullName,email,phone',
      `Corrected Spelling,${existing.email},`,
      `New Person,new-${stamp}@example.test,${phone}`,
    ].join('\n'),
    seasonId: null,
  });
  assert.equal(fixed.ok, true);
  if (!fixed.ok) return;

  const committed = await commitImport(staff, fixed.value.id);
  assert.equal(committed.ok, true);
  if (!committed.ok) return;

  assert.deepEqual(committed.value, { createdCount: 1, updatedCount: 1 });
  assert.equal(
    (await db.customer.findUniqueOrThrow({ where: { id: existing.id } })).fullName,
    'Corrected Spelling',
  );
  assert.equal(await db.customer.count({ where: { email: `new-${stamp}@example.test` } }), 1);

  const twice = await commitImport(staff, fixed.value.id);
  assert.equal(twice.ok, false);
  assert.equal(await db.customer.count({ where: { email: `new-${stamp}@example.test` } }), 1);

  const settled = await readBatch(fixed.value.id);
  assert.equal(settled?.status, 'COMMITTED');

  const audit = await db.auditEvent.findFirst({
    where: { action: 'import.committed', entityId: fixed.value.id },
  });
  assert.ok(audit);
});

test('an import never renames a record it only matched by phone number', async () => {
  const staff = await createStaffContext([...MANAGER]);
  const stamp = Date.now().toString(36);
  const digits = String(Date.now()).slice(-7);
  const phone = `732-${digits.slice(0, 3)}-${digits.slice(3)}`;

  const onFile = await createCustomer('Real Name On File');
  await db.customer.update({
    where: { id: onFile.id },
    data: { phone, normalizedPhone: `+1732${digits}` },
  });

  // A new email address next to a number somebody already holds: the operator
  // typed a name beside a phone number, not a correction to the name on file.
  const staged = await stageImport(staff, {
    kind: 'CUSTOMERS',
    fileName: 'phones.csv',
    content: ['fullName,email,phone', `Somebody Else,other-${stamp}@example.test,${phone}`].join('\n'),
    seasonId: null,
  });

  assert.equal(staged.ok, true);
  if (!staged.ok) return;
  assert.equal(staged.value.rows[0].status, 'DUPLICATE');
  assert.equal(staged.value.rows[0].matchedId, onFile.id);

  const committed = await commitImport(staff, staged.value.id);
  assert.equal(committed.ok, true);

  assert.equal(
    (await db.customer.findUniqueOrThrow({ where: { id: onFile.id } })).fullName,
    'Real Name On File',
  );
  assert.equal(await db.customer.count({ where: { email: `other-${stamp}@example.test` } }), 0);
});

test('a product import needs a season, and rejects a price nobody can charge', async () => {
  const season = await createSeason();
  const staff = await createStaffContext([...MANAGER]);

  const seasonless = await stageImport(staff, {
    kind: 'PRODUCTS',
    fileName: 'catalog.csv',
    content: 'slug,name,price\nclassic-box,Classic,36',
    seasonId: null,
  });
  assert.equal(seasonless.ok, false);

  const staged = await stageImport(staff, {
    kind: 'PRODUCTS',
    fileName: 'catalog.csv',
    content: [
      'slug,name,price,category',
      'classic-box,Classic box,36.50,Boxes',
      'Not A Slug,Bad,10,',
      'free-box,Free,nothing,',
    ].join('\n'),
    seasonId: season.id,
  });

  assert.equal(staged.ok, true);
  if (!staged.ok) return;

  assert.deepEqual(
    staged.value.rows.map((row) => row.status),
    ['VALID', 'INVALID', 'INVALID'],
  );
  assert.equal(staged.value.rows[0].parsed.pricecents, '3650');
});
