import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { scanAddressBook } from '../src/lib/migration/address-cleanup';
import { dryRunLegacyImport } from '../src/lib/migration/legacy-import';
import { readLegacyRow, repairOrderReference } from '../src/lib/migration/legacy-rows';
import { ORDERS_PER_CHUNK } from '../src/lib/migration/legacy-verdicts';
import { createCustomer, createSeason, createStaffContext, db } from './fixtures';

after(() => db.$disconnect());

const HEADER =
  'orderNo,orderDate,donor,donorEmail,donorPhone,recipient,street,street2,city,state,zip,itemCode,item,qty,price,greeting';

test('an order number written five ways is repaired to one', () => {
  for (const written of ['1042', '01042', '#1042', '#1,042 ', ' 1042']) {
    assert.equal(repairOrderReference(written), '1042', `"${written}" is order 1042`);
  }

  assert.equal(repairOrderReference('1042-A'), '1042-A', 'a suffix was a real distinction; it stays');
  assert.equal(repairOrderReference('   '), null, 'nothing is not an order number');
  assert.equal(repairOrderReference('see note'), null, 'a sentence is not an order number');
});

test('a row that cannot be read says why, and does not stop the file', () => {
  const base = {
    orderno: '3300',
    orderdate: '02/14/2026',
    donor: 'Yaakov Stein',
    donoremail: 'stein@example.test',
    recipient: 'Reb Shmuel',
    street: '12 Main Street',
    city: 'Lakewood',
    state: 'nj',
    zip: '08701',
    item: 'Classic Purim box',
    itemcode: 'CLASSIC',
    qty: '',
    price: '$36.00',
    greeting: '',
  };

  const good = readLegacyRow(base);
  assert.equal(good.ok, true);
  if (!good.ok) return;

  assert.equal(good.row.unitPriceCents, 3600, '$36.00 is money');
  assert.equal(good.row.quantity, 1, 'a blank quantity is one box, not a refusal');
  assert.equal(good.row.address.state, 'NJ');
  assert.equal(good.row.productSlug, 'classic', 'the old item code becomes the slug');

  const problems: Record<string, string> = {
    'The price cannot be read as an amount.': 'free',
  };

  for (const [problem, price] of Object.entries(problems)) {
    const read = readLegacyRow({ ...base, price });
    assert.equal(read.ok, false);
    if (!read.ok) assert.equal(read.problem, problem);
  }

  const noOrder = readLegacyRow({ ...base, orderno: '  ' });
  assert.equal(noOrder.ok, false);
  if (!noOrder.ok) {
    assert.match(noOrder.problem, /order number/, 'the row says what is wrong with it');
  }

  const noDonor = readLegacyRow({ ...base, donor: '' });
  assert.equal(noDonor.ok, false);

  // The unreadable rows above did not change the readable one.
  assert.equal(readLegacyRow(base).ok, true);
});

test('an address the post office could not use is flagged rather than dropped', async () => {
  const read = readLegacyRow({
    orderno: '3302',
    orderdate: '02/14/2026',
    donor: 'Malka Berger',
    donoremail: 'berger@example.test',
    recipient: 'The Rov',
    street: '12 Main Street',
    city: 'Lakewood',
    state: 'NJ',
    zip: '',
    item: 'Classic Purim box',
    qty: '1',
    price: '25.00',
  });

  assert.equal(read.ok, true, 'a broken address does not lose the order');
  if (!read.ok) return;

  assert.equal(read.row.address.problem, 'The ZIP code is not five digits, or five plus four.');
  assert.match(read.note ?? '', /ZIP/, 'the reason travels with the row');

  // The import and the cleanup queue read one rule, so ZIP+4 is not flagged on
  // the way in and then quietly cleared by the next scan.
  const zipPlusFour = readLegacyRow({
    orderno: '3303',
    orderdate: '02/14/2026',
    donor: 'Malka Berger',
    donoremail: 'berger@example.test',
    recipient: 'The Rov',
    street: '12 Main Street',
    city: 'Lakewood',
    state: 'NJ',
    zip: '08701-1234',
    item: 'Classic Purim box',
    qty: '1',
    price: '25.00',
  });

  assert.equal(zipPlusFour.ok, true);
  if (zipPlusFour.ok) assert.equal(zipPlusFour.row.address.problem, null, 'ZIP+4 is a ZIP code');

  const customer = await createCustomer('Malka Berger');
  const address = await db.customerAddress.create({
    data: {
      customerId: customer.id,
      addressKey: `cleanup-${customer.id}`,
      recipientName: 'The Rov',
      line1: '12 Main Street',
      city: 'Lakewood',
      state: 'NJ',
      postalCode: '',
      needsReview: true,
      reviewNote: read.row.address.problem,
    },
  });

  await scanAddressBook(await createStaffContext(['migration.manage']));

  const flag = await db.addressCleanupFlag.findUnique({
    where: { fingerprint: `UNUSABLE_ADDRESS:${address.id}` },
  });

  assert.ok(flag, 'the address is in the queue rather than gone');
  assert.equal(flag.status, 'OPEN');
  assert.match(flag.note, /The Rov/, 'the queue names who it is about');
});

test('two spellings of one mailbox are found as one household', async () => {
  const mailbox = `klein${Date.now().toString(36)}`;

  const first = await db.customer.create({
    data: {
      email: `${mailbox}@example.test`,
      normalizedEmail: `${mailbox}@example.test`,
      fullName: 'Chaya Klein',
    },
  });
  const alias = await db.customer.create({
    data: {
      email: `${mailbox.slice(0, 5)}.${mailbox.slice(5)}+shul@example.test`,
      normalizedEmail: `${mailbox.slice(0, 5)}.${mailbox.slice(5)}+shul@example.test`,
      fullName: 'Chaya Klein',
    },
  });

  await scanAddressBook(await createStaffContext(['migration.manage']));

  const flag = await db.addressCleanupFlag.findUnique({
    where: { fingerprint: `DUPLICATE_CUSTOMER:${first.id}:${alias.id}` },
  });

  assert.ok(flag, 'a dot and a +tag are the same mailbox');
  assert.equal(flag.duplicateOfCustomerId, first.id, 'the older account is the survivor');
  assert.equal(flag.customerId, alias.id);
});

test('a chunk is always a whole number of orders', async () => {
  const season = await createSeason();
  await db.fulfillmentMethod.create({
    data: {
      code: `chunk-method-${season.year}`,
      label: 'Test delivery',
      kind: 'DELIVERY',
      requiresAddress: true,
      isActive: true,
    },
  });

  // Twelve orders, one of which sent three boxes: the file cannot be cut into
  // fives without splitting an order unless the chunker groups first.
  const rows: string[] = [];
  for (let index = 0; index < 12; index += 1) {
    const reference = 9100 + index;
    const lines = index === 3 ? 3 : 1;

    for (let line = 0; line < lines; line += 1) {
      rows.push(
        `${reference},02/14/${season.year},Donor ${index},donor${index}-${season.year}@example.test,,Recipient ${line},${100 + index} Legacy Avenue,,Lakewood,NJ,08701,CLASSIC,Classic Purim box,1,36.00,`,
      );
    }
  }

  const staged = await dryRunLegacyImport(await createStaffContext(['migration.manage']), {
    fileName: 'chunking.csv',
    content: [HEADER, ...rows].join('\r\n'),
    seasonYear: season.year,
  });

  assert.equal(staged.ok, true);
  if (!staged.ok) return;

  assert.equal(staged.value.rowCount, 14);
  assert.equal(staged.value.validCount, 14);
  assert.equal(staged.value.chunkCount, 3, '12 orders in fives is three chunks');

  const written = await db.legacyImportRow.findMany({ where: { runId: staged.value.id } });
  const chunkOf = new Map<string, number[]>();

  for (const row of written) {
    const reference = row.orderReference ?? '';
    chunkOf.set(reference, [...(chunkOf.get(reference) ?? []), row.chunkIndex]);
  }

  for (const [reference, chunks] of chunkOf) {
    assert.equal(new Set(chunks).size, 1, `order ${reference} is in one chunk, not split across two`);
  }

  const perChunk = new Map<number, Set<string>>();
  for (const [reference, chunks] of chunkOf) {
    const chunk = chunks[0];
    perChunk.set(chunk, (perChunk.get(chunk) ?? new Set()).add(reference));
  }

  for (const [chunk, references] of perChunk) {
    assert.ok(
      references.size <= ORDERS_PER_CHUNK,
      `chunk ${chunk} holds ${references.size} orders, more than the ${ORDERS_PER_CHUNK} a transaction is allowed`,
    );
  }

  // The dry run is a dry run: nothing was written into the season.
  assert.equal(await db.order.count({ where: { seasonId: season.id } }), 0);
  assert.equal(staged.value.status, 'DRY_RUN');
});
