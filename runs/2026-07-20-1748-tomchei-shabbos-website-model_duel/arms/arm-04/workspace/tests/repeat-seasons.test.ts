import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { closestPricedProduct, resolveReplacements } from '../src/lib/catalog/replacements';
import { normalizeAddressKey } from '../src/lib/core/normalize';
import { formatInZone, wallClockToUtc } from '../src/lib/core/timezone';
import { importPriorYearOrder } from '../src/lib/imports/prior-year-orders';
import { buildRepeatPlan } from '../src/lib/orders/repeat-plan';
import { confirmRepeat, readRepeatReview } from '../src/lib/orders/repeat-review';
import { repeatLatestOrderForCustomer } from '../src/lib/orders/repeat-order';
import { setSeasonStatus } from '../src/lib/seasons/management';
import { setSeasonSchedule } from '../src/lib/seasons/schedule';
import { createSeasonFromWizard } from '../src/lib/seasons/wizard';
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

const MANAGER = ['seasons.manage', 'catalog.manage', 'orders.manage'] as const;

/**
 * The wizard only accepts four-digit years, and the shared fixture numbers its
 * seasons from 3000 up so they never collide. This finds a free pair inside the
 * range a manager could actually type.
 */
async function freeSeasonYear(): Promise<number> {
  const taken = new Set(
    (
      await db.season.findMany({ where: { year: { gte: 2000, lte: 2098 } }, select: { year: true } })
    ).map((season) => season.year),
  );

  for (let year = 2000; year <= 2098; year += 1) {
    if (!taken.has(year) && !taken.has(year + 1)) return year;
  }

  throw new Error('No free season year pair left in the test database.');
}

test('a replacement chain resolves forward, and the same slug beats a stale mapping', async () => {
  const [oldSeason, midSeason, newSeason] = [
    await createSeason('CLOSED'),
    await createSeason('CLOSED'),
    await createSeason('CLOSED'),
  ];

  // Renamed twice: 2024 -> 2025 -> 2026, none of them sharing a slug.
  const oldBox = await createProduct(oldSeason, { priceCents: 4200 });
  const midBox = await createProduct(midSeason, { priceCents: 4400 });
  const newBox = await createProduct(newSeason, { priceCents: 4600 });
  await db.product.update({ where: { id: oldBox.id }, data: { replacedByProductId: midBox.id } });
  await db.product.update({ where: { id: midBox.id }, data: { replacedByProductId: newBox.id } });

  // Still sold under its own slug, but carrying a mapping from the year it was
  // nearly dropped. The slug has to win.
  const survivor = await createProduct(oldSeason, { priceCents: 1800 });
  const survivorToday = await db.product.create({
    data: { seasonId: newSeason.id, slug: survivor.slug, name: 'Same box, new year', priceCents: 1900 },
  });
  await db.product.update({ where: { id: survivor.id }, data: { replacedByProductId: newBox.id } });

  const retired = await createProduct(oldSeason, { priceCents: 5400 });

  const resolutions = await resolveReplacements(
    [oldBox.id, survivor.id, retired.id],
    newSeason.id,
  );

  const chained = resolutions.get(oldBox.id);
  assert.equal(chained?.kind, 'mapped');
  assert.equal(chained?.kind === 'mapped' ? chained.product.id : null, newBox.id);
  assert.equal(chained?.kind === 'mapped' ? chained.hops : 0, 2);

  const kept = resolutions.get(survivor.id);
  assert.equal(kept?.kind, 'same');
  assert.equal(kept?.kind === 'same' ? kept.product.id : null, survivorToday.id);

  assert.equal(resolutions.get(retired.id)?.kind, 'unmapped');
});

test('a mapping loop resolves to nothing rather than walking forever', async () => {
  const season = await createSeason('CLOSED');
  const target = await createSeason('CLOSED');

  const first = await createProduct(season, { priceCents: 1000 });
  const second = await createProduct(season, { priceCents: 1000 });
  await db.product.update({ where: { id: first.id }, data: { replacedByProductId: second.id } });
  await db.product.update({ where: { id: second.id }, data: { replacedByProductId: first.id } });

  const resolutions = await resolveReplacements([first.id], target.id);
  assert.equal(resolutions.get(first.id)?.kind, 'unmapped');
});

test('the price-smart suggestion stays inside the category it came from', () => {
  const candidates = [
    { id: 'wine-1', slug: 'wine-1', name: 'Wine basket', priceCents: 5000, category: 'Wine' },
    { id: 'wine-2', slug: 'wine-2', name: 'Big wine basket', priceCents: 9000, category: 'Wine' },
    { id: 'sweets', slug: 'sweets', name: 'Sweets box', priceCents: 5400, category: 'Sweets' },
  ];

  const suggested = closestPricedProduct(candidates, 5400, 'Wine');
  assert.equal(suggested?.id, 'wine-1', 'the nearest price in the same category, not across all of them');

  const anywhere = closestPricedProduct(candidates, 5400, null);
  assert.equal(anywhere?.id, 'sweets');
});

test('a repeat with a discontinued line has to be decided before it becomes a draft', async () => {
  const lastSeason = await createSeason('CLOSED');
  const thisSeason = await createSeason('OPEN');
  await writeSetting('store.open', true);

  const method = await createFulfillmentMethod('DELIVERY');
  const customer = await createCustomer('Repeat Customer');

  const gone = await createProduct(lastSeason, { priceCents: 5400 });
  const stillHere = await createProduct(lastSeason, { priceCents: 3000 });
  const stillHereToday = await db.product.create({
    data: { seasonId: thisSeason.id, slug: stillHere.slug, name: 'Classic box', priceCents: 3200 },
  });
  const standIn = await db.product.create({
    data: { seasonId: thisSeason.id, slug: `stand-in-${gone.slug}`, name: 'Deluxe box', priceCents: 5600 },
  });

  const addressParts = {
    line1: '12 Main Street',
    city: 'Lakewood',
    state: 'NJ',
    postalCode: '08701',
  };
  const address = await db.customerAddress.create({
    data: {
      customerId: customer.id,
      recipientName: 'Aunt Rivka',
      ...addressParts,
      addressKey: normalizeAddressKey(addressParts),
    },
  });

  const source = await db.order.create({
    data: {
      seasonId: lastSeason.id,
      customerId: customer.id,
      status: 'COMPLETED',
      placedAt: new Date(),
      draftReference: `TEST-${customer.id.slice(0, 8)}`,
      lines: {
        create: [gone, stillHere].map((product) => ({
          productId: product.id,
          quantity: 1,
          productNameSnapshot: product.name,
          unitPriceCents: product.priceCents,
          lineTotalCents: product.priceCents,
          recipientName: 'Aunt Rivka',
          fulfillmentMethodId: method.id,
          customerAddressId: address.id,
          addressLine1: address.line1,
          addressCity: address.city,
          addressState: address.state,
          addressPostalCode: address.postalCode,
          addressCountry: 'US',
          greetingMessage: 'Freilichen Purim',
        })),
      },
    },
  });

  const review = await readRepeatReview(customer.id, source.id);
  assert.ok(review.ok, 'the customer may review their own order');
  const plan = review.value.plan;

  assert.equal(plan.needsChoiceCount, 1);
  const orphan = plan.lines.find((line) => line.resolution === 'needs_choice');
  assert.equal(orphan?.product, null);
  assert.equal(orphan?.suggestion?.id, standIn.id, 'the nearest price to what they paid is offered');
  assert.equal(orphan?.recipient.name, 'Aunt Rivka');
  assert.equal(orphan?.greetingMessage, 'Freilichen Purim');

  const carried = plan.lines.find((line) => line.resolution === 'same');
  assert.equal(carried?.product?.id, stillHereToday.id);

  const decisions = new Map(
    plan.lines.map((line) => [
      line.sourceLineId,
      {
        sourceLineId: line.sourceLineId,
        productId: line.product?.id ?? standIn.id,
        removed: false,
        customerAddressId: null,
      },
    ]),
  );

  const unticked = await confirmRepeat(customer.id, source.id, {
    decisions,
    replacementsConfirmed: true,
    recipientsConfirmed: false,
  });
  assert.equal(unticked.ok, false, 'both confirmations are required');

  const undecided = await confirmRepeat(customer.id, source.id, {
    decisions: new Map(
      [...decisions].map(([id, decision]) => [
        id,
        decision.productId === standIn.id ? { ...decision, productId: '' } : decision,
      ]),
    ),
    replacementsConfirmed: true,
    recipientsConfirmed: true,
  });
  assert.equal(undecided.ok, false, 'an unmapped line cannot be left blank');

  const confirmed = await confirmRepeat(customer.id, source.id, {
    decisions,
    replacementsConfirmed: true,
    recipientsConfirmed: true,
  });
  assert.ok(confirmed.ok);
  assert.equal(confirmed.value.copiedLines, 2);
  assert.equal(confirmed.value.swappedLines, 1);

  const draft = await db.order.findUniqueOrThrow({
    where: { id: confirmed.value.draftId },
    include: { lines: true },
  });
  assert.equal(draft.status, 'DRAFT');
  assert.equal(draft.seasonId, thisSeason.id);

  const prices = draft.lines.map((line) => line.unitPriceCents).sort((a, b) => a - b);
  assert.deepEqual(prices, [3200, 5600], 'this season prices, not last season');
  assert.ok(draft.lines.every((line) => line.greetingMessage === 'Freilichen Purim'));
  assert.ok(draft.lines.every((line) => line.recipientName === 'Aunt Rivka'));

  // A second confirm has to refuse: one cart per customer per season.
  const again = await confirmRepeat(customer.id, source.id, {
    decisions,
    replacementsConfirmed: true,
    recipientsConfirmed: true,
  });
  assert.equal(again.ok, false);
});

test('staff repeat of a customer history copies what resolved and names what did not', async () => {
  const lastSeason = await createSeason('CLOSED');
  const thisSeason = await createSeason('OPEN');
  const method = await createFulfillmentMethod('DELIVERY');
  const customer = await createCustomer('Phone Customer');
  const staff = await createStaffContext([...MANAGER]);

  const gone = await createProduct(lastSeason, { priceCents: 4000 });
  const kept = await createProduct(lastSeason, { priceCents: 2000 });
  await db.product.create({
    data: { seasonId: thisSeason.id, slug: kept.slug, name: 'Kept box', priceCents: 2100 },
  });

  await db.order.create({
    data: {
      seasonId: lastSeason.id,
      customerId: customer.id,
      status: 'COMPLETED',
      placedAt: new Date(),
      draftReference: `TEST-STAFF-${customer.id.slice(0, 8)}`,
      lines: {
        create: [gone, kept].map((product) => ({
          productId: product.id,
          quantity: 2,
          productNameSnapshot: product.name,
          unitPriceCents: product.priceCents,
          lineTotalCents: product.priceCents * 2,
          recipientName: 'Cousin Yossi',
          fulfillmentMethodId: method.id,
          addressLine1: '9 Forest Avenue',
          addressCity: 'Lakewood',
          addressState: 'NJ',
          addressPostalCode: '08701',
          addressCountry: 'US',
        })),
      },
    },
  });

  const repeated = await repeatLatestOrderForCustomer(staff, customer.id, thisSeason.id);
  assert.ok(repeated.ok);
  assert.equal(repeated.value.copiedLines, 1);
  assert.deepEqual(repeated.value.skippedLines, [gone.name]);

  const till = await db.order.findUniqueOrThrow({
    where: { id: repeated.value.draftId },
    include: { lines: true },
  });
  assert.equal(till.posStaffUserId, staff.acting.id);
  assert.equal(till.lines[0].quantity, 2, 'quantities come across');

  const second = await repeatLatestOrderForCustomer(staff, customer.id, thisSeason.id);
  assert.equal(second.ok, false, 'one till per customer');
});

test('opening a season closes whichever one was open, and both flips are audited', async () => {
  const staff = await createStaffContext([...MANAGER]);
  const outgoing = await createSeason('OPEN');
  const incoming = await createSeason('CLOSED');

  const flipped = await setSeasonStatus(staff, { seasonId: incoming.id, to: 'OPEN' });
  assert.ok(flipped.ok);

  assert.equal((await db.season.findUniqueOrThrow({ where: { id: outgoing.id } })).status, 'CLOSED');
  assert.equal((await db.season.findUniqueOrThrow({ where: { id: incoming.id } })).status, 'OPEN');

  const again = await setSeasonStatus(staff, { seasonId: incoming.id, to: 'OPEN' });
  assert.equal(again.ok, false, 'a season that is already open is not flipped twice');

  const audits = await db.auditEvent.findMany({
    where: { action: 'season.status_changed', entityId: incoming.id },
  });
  assert.equal(audits.length, 1);
});

test('a schedule is read as the office wall clock and refuses to close before it opens', async () => {
  const staff = await createStaffContext([...MANAGER]);
  const season = await createSeason('CLOSED');
  await writeSetting('store.timezone', 'America/New_York');

  const backwards = await setSeasonSchedule(staff, {
    seasonId: season.id,
    opensAt: '2031-03-01T09:00',
    closesAt: '2031-02-01T09:00',
  });
  assert.equal(backwards.ok, false);

  const saved = await setSeasonSchedule(staff, {
    seasonId: season.id,
    opensAt: '2031-02-01T09:00',
    closesAt: '2031-03-10T17:00',
  });
  assert.ok(saved.ok);

  // 09:00 in New York in February is 14:00 UTC.
  assert.equal(saved.value.opensAt?.toISOString(), '2031-02-01T14:00:00.000Z');
  assert.equal(
    saved.value.opensAt?.getTime(),
    wallClockToUtc('2031-02-01T09:00', 'America/New_York')?.getTime(),
  );

  const cleared = await setSeasonSchedule(staff, { seasonId: season.id, opensAt: '', closesAt: '' });
  assert.ok(cleared.ok);
  assert.equal(cleared.value.opensAt, null);

  // What the calendar prints under the two fields. The zone has to be in it —
  // a schedule that reads "9:00 AM" and means UTC is how a store opens at four
  // in the morning.
  const shown = formatInZone(new Date('2031-02-01T14:00:00.000Z'), 'America/New_York');
  assert.match(shown, /Feb 1, 2031/);
  assert.match(shown, /9:00\s?AM/);
  assert.match(shown, /EST/);
});

test('the wizard copies a catalogue onto empty shelves and leaves the season closed', async () => {
  const staff = await createStaffContext([...MANAGER]);
  const year = await freeSeasonYear();
  const source = await db.season.create({
    data: { year, label: `Purim ${year}`, status: 'OPEN' },
  });
  const carried = await createProduct(source, { priceCents: 3000, onHand: 40 });
  const dropped = await createProduct(source, { priceCents: 7000, onHand: 5 });

  const created = await createSeasonFromWizard(staff, {
    year: source.year + 1,
    label: `Purim ${source.year + 1}`,
    copyFromSeasonId: source.id,
    productIds: [carried.id],
    copyAddOns: false,
    linkReplacements: true,
  });

  assert.ok(created.ok, created.ok ? '' : created.publicMessage);
  assert.equal(created.value.season.status, 'CLOSED');
  assert.equal(created.value.productCount, 1);
  assert.equal(created.value.replacementLinkCount, 1);

  const twin = await db.product.findFirstOrThrow({
    where: { seasonId: created.value.season.id },
    include: { inventory: true },
  });
  assert.equal(twin.slug, carried.slug);
  assert.equal(twin.priceCents, 3000);
  assert.equal(twin.inventory?.onHand, 0, 'a new season starts with nothing on the shelf');

  const linked = await db.product.findUniqueOrThrow({ where: { id: carried.id } });
  assert.equal(linked.replacedByProductId, twin.id);

  const untouched = await db.product.findUniqueOrThrow({ where: { id: dropped.id } });
  assert.equal(untouched.replacedByProductId, null, 'a product left behind is not linked to anything');

  const duplicate = await createSeasonFromWizard(staff, {
    year: source.year + 1,
    label: 'Duplicate',
    copyFromSeasonId: source.id,
    productIds: [],
    copyAddOns: false,
    linkReplacements: false,
  });
  assert.equal(duplicate.ok, false);
});

test('several retired boxes can fold into one survivor', async () => {
  const lastSeason = await createSeason('CLOSED');
  const thisSeason = await createSeason('CLOSED');

  const survivor = await createProduct(thisSeason, { priceCents: 5000 });
  const first = await createProduct(lastSeason, { priceCents: 4000 });
  const second = await createProduct(lastSeason, { priceCents: 4500 });

  for (const product of [first, second]) {
    await db.product.update({
      where: { id: product.id },
      data: { replacedByProductId: survivor.id },
    });
  }

  const resolutions = await resolveReplacements([first.id, second.id], thisSeason.id);

  for (const id of [first.id, second.id]) {
    const resolution = resolutions.get(id);
    assert.equal(resolution?.kind, 'mapped');
    assert.equal(resolution?.kind === 'mapped' ? resolution.product.id : null, survivor.id);
  }
});

test('an imported prior-year order repeats with its products, recipients and greetings', async () => {
  const lastSeason = await createSeason('CLOSED');
  const thisSeason = await createSeason('OPEN');
  await createFulfillmentMethod('DELIVERY');

  const reference = `LEGACY-${lastSeason.year}-0001`;
  const email = `legacy-${lastSeason.year}@example.test`;

  const input = {
    reference,
    seasonYear: lastSeason.year,
    customerEmail: email,
    customerName: 'Legacy Donor',
    placedAt: new Date('2025-03-01T12:00:00Z'),
    lines: [
      {
        productSlug: 'classic-box',
        productName: 'Classic box',
        category: 'Boxes',
        quantity: 2,
        unitPriceCents: 3600,
        recipientName: 'Bubby Malka',
        address: { line1: '18 Cedar Lane', city: 'Lakewood', state: 'NJ', postalCode: '08701' },
        greetingMessage: 'From the whole family',
      },
    ],
  };

  const imported = await importPriorYearOrder(input);
  assert.ok(imported.ok);
  assert.equal(imported.value.importedOrderReference, reference);

  const rerun = await importPriorYearOrder(input);
  assert.ok(rerun.ok);
  assert.equal(rerun.value.id, imported.value.id, 're-importing corrects rather than duplicates');

  // Same slug next season, so the repeat resolves without anyone deciding.
  await db.product.create({
    data: { seasonId: thisSeason.id, slug: 'classic-box', name: 'Classic box', priceCents: 3900 },
  });

  const plan = await buildRepeatPlan(imported.value.id, thisSeason.id);
  assert.ok(plan.ok);
  assert.equal(plan.value.wasImported, true);
  assert.equal(plan.value.needsChoiceCount, 0);

  const [line] = plan.value.lines;
  assert.equal(line.resolution, 'same');
  assert.equal(line.product?.priceCents, 3900);
  assert.equal(line.quantity, 2);
  assert.equal(line.recipient.name, 'Bubby Malka');
  assert.equal(line.recipient.state, 'ready', 'the imported address is in the book');
  assert.equal(line.greetingMessage, 'From the whole family');
  assert.ok(plan.value.addressBook.some((address) => address.recipientName === 'Bubby Malka'));
});
