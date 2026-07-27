import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { csvAmount, csvDate, csvRow, toCsv } from '../src/lib/reports/csv-write';
import type { ExportDefinition } from '../src/lib/reports/datasets';
import { csvExportResponse } from '../src/lib/reports/export-service';
import { COUNTED_ORDER_STATUSES, readSeasonPerformance } from '../src/lib/reports/season-performance';
import {
  createCustomer,
  createFulfillmentMethod,
  createProduct,
  createSeason,
  createStaffContext,
  db,
} from './fixtures';

after(() => db.$disconnect());

/**
 * The spreadsheet file is the one artefact of this system that runs on somebody
 * else's computer, so what is dangerous about it is tested here rather than
 * only through a download.
 */
test('a value a spreadsheet would run as a formula is written as text', () => {
  const row = csvRow(['=HYPERLINK("http://evil.test")', '+1', '@SUM(A1)', '-5', '-lookup']);

  assert.equal(
    row,
    `"'=HYPERLINK(""http://evil.test"")",'+1,'@SUM(A1),-5,'-lookup\r\n`,
    'every formula starter is prefixed, and a negative number is left alone',
  );
});

test('a value with a comma, a quote or a newline survives the round trip', () => {
  const row = csvRow(['Klein, Miriam', 'She said "yes"', 'line one\nline two', ' padded ', '']);

  assert.equal(
    row,
    '"Klein, Miriam",'
      + '"She said ""yes""",'
      + '"line one\nline two",'
      + '" padded ",'
      + '\r\n',
  );
});

test('money and dates are written in forms a spreadsheet adds up', () => {
  assert.equal(csvAmount(0), '0.00');
  assert.equal(csvAmount(3600), '36.00');
  assert.equal(csvAmount(-1250), '-12.50');
  assert.equal(csvAmount(5), '0.05');
  assert.equal(csvAmount(null), '', 'nothing is not zero');

  assert.equal(csvDate(new Date('2026-03-03T22:00:00.000Z')), '2026-03-03');
  assert.equal(csvDate(null), '');

  const file = toCsv(['Total'], [[csvAmount(123456)]]);
  assert.equal(file, 'Total\r\n1234.56\r\n', 'no thousands separator, or the column stops adding up');
});

/** A dataset of any size, and a count of how often it was asked for a page. */
function countedExport(rowCount: number): {
  definition: ExportDefinition;
  pageCalls: () => number;
} {
  let calls = 0;

  return {
    pageCalls: () => calls,
    definition: {
      dataset: 'DELIVERIES',
      label: 'Recipients',
      description: 'A dataset that only produces rows when it is asked for them.',
      fileSlug: 'recipients',
      headers: ['Recipient'],
      count: async () => rowCount,
      page: async (_seasonId, skip, take) => {
        calls += 1;
        const remaining = Math.max(0, Math.min(take, rowCount - skip));
        return Array.from({ length: remaining }, (_, index) => [`Recipient ${skip + index}`]);
      },
    },
  };
}

test('an export is stamped complete only once the client has taken the rows', async () => {
  const season = await createSeason();
  const staff = await createStaffContext(['reports.view']);
  const { definition, pageCalls } = countedExport(2);

  const response = await csvExportResponse(
    definition,
    { id: season.id, label: season.label, year: season.year },
    staff,
  );

  const logged = await db.exportLog.findFirstOrThrow({
    where: { seasonId: season.id },
    orderBy: { createdAt: 'desc' },
  });
  assert.equal(logged.completedAt, null, 'nothing has gone out yet');
  assert.equal(pageCalls(), 0, 'no page is read before the client asks for one');
  assert.equal(logged.staffUserId, staff.actor.id, 'the file is attributed to who signed in');

  const body = await response.text();
  assert.equal(body, 'Recipient\r\nRecipient 0\r\nRecipient 1\r\n');
  assert.equal(pageCalls(), 1);

  const finished = await db.exportLog.findUniqueOrThrow({ where: { id: logged.id } });
  assert.ok(finished.completedAt, 'the whole file reached the client');
  assert.equal(finished.rowCount, 2);
  assert.equal(finished.byteCount, Buffer.byteLength(body));
});

test('an export the client abandons stops there and is not stamped complete', async () => {
  const season = await createSeason();
  const staff = await createStaffContext(['reports.view']);
  const { definition, pageCalls } = countedExport(1200);

  const response = await csvExportResponse(
    definition,
    { id: season.id, label: season.label, year: season.year },
    staff,
  );

  const reader = response.body?.getReader();
  assert.ok(reader);
  await reader.read();
  await reader.cancel();

  const logged = await db.exportLog.findFirstOrThrow({
    where: { seasonId: season.id },
    orderBy: { createdAt: 'desc' },
  });
  assert.equal(logged.completedAt, null, 'a download that stopped part way says so');
  assert.equal(pageCalls(), 1, 'the rest of the file was never read out of the database');
  assert.equal(logged.rowCount, 500, 'one page went out, not twelve hundred rows');
});

test('a season counts placed orders and ignores drafts and cancellations', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const product = await createProduct(season, { priceCents: 3600 });
  const method = await createFulfillmentMethod();

  const line = {
    productId: product.id,
    quantity: 1,
    productNameSnapshot: product.name,
    unitPriceCents: 3600,
    lineTotalCents: 3600,
    recipientName: 'Counted Recipient',
    fulfillmentMethodId: method.id,
    addressLine1: '1 Test Street',
    addressCity: 'Lakewood',
    addressState: 'NJ',
    addressPostalCode: '08701',
    addressCountry: 'US',
  };

  for (const [index, status] of (['PLACED', 'COMPLETED', 'DRAFT', 'CANCELLED'] as const).entries()) {
    await db.order.create({
      data: {
        seasonId: season.id,
        customerId: customer.id,
        status,
        draftReference: `D-RPT-${season.year}-${index}`,
        subtotalCents: 3600,
        totalCents: 3600,
        amountPaidCents: status === 'COMPLETED' ? 3600 : 0,
        lines: { create: [line] },
      },
    });
  }

  const totals = (await readSeasonPerformance()).find((row) => row.seasonId === season.id);
  assert.ok(totals);

  assert.deepEqual(
    COUNTED_ORDER_STATUSES,
    ['PLACED', 'IN_FULFILLMENT', 'COMPLETED'],
    'one definition of "counts", written once',
  );
  assert.equal(totals.orderCount, 2, 'the draft basket and the cancelled order are not income');
  assert.equal(totals.customerCount, 1, 'two orders from one household is one household');
  assert.equal(totals.revenueCents, 7200);
  assert.equal(totals.paidCents, 3600);
  assert.equal(totals.outstandingCents, 3600);
});
