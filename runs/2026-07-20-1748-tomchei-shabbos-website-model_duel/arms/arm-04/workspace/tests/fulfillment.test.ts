import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { bulkAdvanceStage } from '../src/lib/fulfillment/bulk-stages';
import { readChannelSummaries } from '../src/lib/fulfillment/channel-summary';
import { listPackageBoard, readBoardFilters } from '../src/lib/fulfillment/package-board';
import {
  movePackageLines,
  PACKAGE_ALREADY_GONE,
  splitPackage,
  SPLIT_NEEDS_REMAINDER,
} from '../src/lib/fulfillment/package-edit';
import { advancePackageStage } from '../src/lib/fulfillment/packages';
import { PRINT_ARTIFACTS } from '../src/lib/print/documents';
import { filingGroupOf, filingSortKey, type FilingSubject } from '../src/lib/print/filing-groups';
import {
  buildNightlyBatch,
  NIGHTLY_PRINT_JOB,
  readBatch,
  reprintGroup,
  reprintOrder,
} from '../src/lib/print/print-batch-service';
import { NOT_PRINTABLE, NOTHING_TO_PRINT, PRINT_GROUP_NOT_FOUND } from '../src/lib/print/print-filing';
import { renderGroupArtifact, renderOrderArtifact } from '../src/lib/print/print-render';
import { readPageRequest } from '../src/lib/admin/list-query';
import { STALE_VERSION } from '../src/lib/core/result';
import { finalizeOrder } from '../src/lib/orders/order-service';
import {
  createCustomer,
  createDraftOrder,
  createFulfillmentMethod,
  createPickupLocation,
  createProduct,
  createSeason,
  createStaffContext,
  db,
} from './fixtures';

after(() => db.$disconnect());

const SUBJECT: FilingSubject = {
  methodCode: 'volunteer',
  methodLabel: 'Volunteer delivery',
  methodKind: 'DELIVERY',
  methodSortOrder: 2,
  pickupLocationId: null,
  pickupLocationName: null,
  deliveryDay: 'Tuesday',
  recipientName: 'Miriam Klein',
  orderNumber: 12,
  draftReference: 'D-AAAA-BBBB',
};

test('filing groups follow how the boxes are actually worked', () => {
  const tuesday = filingGroupOf(SUBJECT);
  const wednesday = filingGroupOf({ ...SUBJECT, deliveryDay: 'Wednesday' });
  assert.notEqual(tuesday.filingKey, wednesday.filingKey, 'two drives are two piles');

  const counter = filingGroupOf({
    ...SUBJECT,
    methodKind: 'PICKUP',
    methodCode: 'pickup',
    pickupLocationId: 'counter-1',
    pickupLocationName: 'Main office',
    deliveryDay: null,
  });
  assert.match(counter.filingKey, /counter-1$/);
  assert.match(counter.label, /Main office/);

  const shipping = filingGroupOf({ ...SUBJECT, methodKind: 'SHIPPING', deliveryDay: null });
  assert.equal(shipping.filingKey, 'volunteer', 'the carrier collects one pile per method');
});

test('boxes are filed by the recipient last name, not by order number', () => {
  const klein = filingSortKey(SUBJECT);
  const zimmer = filingSortKey({ ...SUBJECT, recipientName: 'Aaron Zimmer', orderNumber: 1 });

  assert.ok(klein.localeCompare(zimmer) < 0, 'Klein files before Zimmer whatever the numbers are');
});

test('splitting a box moves the named lines and leaves the money where it was', async () => {
  const { order, method } = await placedOrder({ recipients: ['Miriam Klein', 'Miriam Klein'] });
  const staff = await createStaffContext(['fulfillment.manage']);

  const box = await db.package.findFirstOrThrow({
    where: { orderId: order.id },
    include: { lines: true },
  });
  assert.equal(box.lines.length, 2, 'one recipient, one destination, one box');
  assert.equal(box.fulfillmentFeeCents, method.baseFeeCents);

  const split = await splitPackage(
    { packageId: box.id, expectedVersion: box.version, lineIds: [box.lines[0].id] },
    staff,
  );
  assert.equal(split.ok, true);
  assert.equal(split.ok && split.value.fulfillmentFeeCents, 0, 'a split does not re-price the order');
  assert.equal(split.ok && split.value.recipientName, box.recipientName);
  assert.equal(split.ok && split.value.stage, 'NEW');

  const boxes = await db.package.findMany({
    where: { orderId: order.id },
    include: { lines: true },
  });
  assert.deepEqual(
    boxes.map((row) => row.lines.length).sort(),
    [1, 1],
    'both halves keep their line',
  );

  const placed = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(placed.fulfillmentFeeCents, method.baseFeeCents, 'the order still costs what it did');

  const audit = await db.auditEvent.findFirstOrThrow({
    where: { action: 'package.split', entityId: split.ok ? split.value.id : '' },
  });
  assert.equal(audit.actorStaffUserId, staff.actor.id);
  assert.deepEqual(audit.detail, {
    orderId: order.id,
    fromPackageId: box.id,
    lineCount: 1,
  });
});

test('a split needs something to leave behind, and a stale screen loses', async () => {
  const { order } = await placedOrder({
    recipients: ['Miriam Klein', 'Miriam Klein', 'Miriam Klein'],
  });

  const box = await db.package.findFirstOrThrow({
    where: { orderId: order.id },
    include: { lines: true },
  });
  const lineIds = box.lines.map((line) => line.id);

  const everything = await splitPackage(
    { packageId: box.id, expectedVersion: box.version, lineIds },
    null,
  );
  assert.equal(everything.ok === false && everything.code, SPLIT_NEEDS_REMAINDER);

  const first = await splitPackage(
    { packageId: box.id, expectedVersion: box.version, lineIds: [lineIds[0]] },
    null,
  );
  assert.equal(first.ok, true);

  const replay = await splitPackage(
    { packageId: box.id, expectedVersion: box.version, lineIds: [lineIds[1]] },
    null,
  );
  assert.equal(replay.ok === false && replay.code, STALE_VERSION);
});

test('regrouping the last line back empties the box it came from', async () => {
  const { order } = await placedOrder({ recipients: ['Miriam Klein', 'Miriam Klein'] });

  const original = await db.package.findFirstOrThrow({
    where: { orderId: order.id },
    include: { lines: true },
  });

  const split = await splitPackage(
    { packageId: original.id, expectedVersion: original.version, lineIds: [original.lines[0].id] },
    null,
  );
  assert.equal(split.ok, true);
  if (!split.ok) return;

  const moved = await movePackageLines(
    {
      fromPackageId: split.value.id,
      toPackageId: original.id,
      expectedVersion: split.value.version,
      lineIds: [original.lines[0].id],
    },
    null,
  );

  assert.equal(moved.ok, true);
  assert.equal(moved.ok && moved.value.sourceRemoved, true);

  const boxes = await db.package.findMany({
    where: { orderId: order.id },
    include: { lines: true },
  });
  assert.equal(boxes.length, 1, 'the empty half is gone');
  assert.equal(boxes[0].lines.length, 2);

  const emptied = await db.auditEvent.findFirst({
    where: { action: 'package.emptied', entityId: split.value.id },
  });
  assert.ok(emptied, 'a box that disappeared says so in the trail');
});

test('a box that has already gone out cannot be re-packed', async () => {
  const { order, season } = await placedOrder({ recipients: ['Miriam Klein', 'Miriam Klein'] });

  const box = await db.package.findFirstOrThrow({
    where: { orderId: order.id },
    include: { lines: true },
  });

  const sent = await advancePackageStage(
    { packageId: box.id, seasonId: season.id, expectedVersion: box.version, stage: 'SENT' },
    null,
  );
  assert.equal(sent.ok, true);

  const refused = await splitPackage(
    { packageId: box.id, expectedVersion: sent.ok ? sent.value.version : 0, lineIds: [box.lines[0].id] },
    null,
  );
  assert.equal(refused.ok === false && refused.code, PACKAGE_ALREADY_GONE);
});

test('a pickup box is collected, never sent', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const counter = await createPickupLocation();
  const method = await createFulfillmentMethod('PICKUP', 0, 'NONE');
  const product = await createProduct(season);

  const draft = await createDraftOrder({
    season,
    customer,
    lines: [{ product, fulfillmentMethodId: method.id, recipientName: 'Shani Adler' }],
  });
  await db.orderLine.updateMany({
    where: { orderId: draft.id },
    data: { pickupLocationId: counter.id },
  });
  await finalizeOrder(draft.id, null);

  const box = await db.package.findFirstOrThrow({ where: { orderId: draft.id } });
  const refused = await advancePackageStage(
    { packageId: box.id, seasonId: season.id, expectedVersion: box.version, stage: 'SENT' },
    null,
  );
  assert.equal(refused.ok, false);

  const collected = await advancePackageStage(
    { packageId: box.id, seasonId: season.id, expectedVersion: box.version, stage: 'PICKED_UP' },
    null,
  );
  assert.equal(collected.ok && collected.value.stage, 'PICKED_UP');
});

test('the nightly batch files every unprinted box once and only once', async () => {
  const startedAt = new Date();
  const season = await createSeason();
  const customer = await createCustomer();
  const product = await createProduct(season);
  const tuesday = await createFulfillmentMethod('DELIVERY', 500);
  const shipping = await createFulfillmentMethod('SHIPPING', 0, 'NONE');

  const draft = await createDraftOrder({
    season,
    customer,
    lines: [
      { product, fulfillmentMethodId: tuesday.id, recipientName: 'Miriam Klein' },
      { product, fulfillmentMethodId: shipping.id, recipientName: 'Aaron Zimmer' },
    ],
  });
  await finalizeOrder(draft.id, null);

  const built = await buildNightlyBatch(null, { seasonId: season.id });
  assert.equal(built.ok, true);
  assert.equal(built.ok && built.value.packageCount, 2);
  assert.equal(built.ok && built.value.groupCount, 2, 'two channels, two piles');

  const again = await buildNightlyBatch(null, { seasonId: season.id });
  assert.equal(again.ok && again.value.batchId, null, 'a second run finds nothing');
  assert.equal(again.ok && again.value.packageCount, 0);

  const runs = await db.cronRunLog.findMany({
    where: { jobName: NIGHTLY_PRINT_JOB, startedAt: { gte: startedAt } },
  });
  assert.equal(runs.length, 2, 'a run that had nothing to do still leaves a row');
  assert.ok(runs.every((run) => run.status === 'SUCCEEDED'));
});

test('reprinting one group leaves the other groups exactly as they were', async () => {
  const { batch, seasonId } = await batchedOrder();

  const reprinted = await reprintGroup(null, {
    batchId: batch.id,
    groupId: batch.groups[0].id,
    seasonId,
  });
  assert.equal(reprinted.ok, true);
  if (!reprinted.ok) return;

  const original = await readBatch(seasonId, batch.id);
  assert.deepEqual(
    original?.groups.map((group) => group.packageCount),
    batch.groups.map((group) => group.packageCount),
    'the batch already on the table is a record, not a draft',
  );

  const copy = await db.printBatch.findUniqueOrThrow({
    where: { id: reprinted.value.batchId },
    include: { groups: { include: { items: true } } },
  });
  assert.equal(copy.kind, 'REPRINT');
  assert.equal(copy.supersedesBatchId, batch.id);
  assert.equal(copy.groups.length, 1, 'a reprint of one group is one group');
  assert.equal(copy.groups[0].items.length, batch.groups[0].packageCount);

  const untouched = await db.package.count({
    where: { order: { seasonId }, stage: { not: 'NEW' } },
  });
  assert.equal(untouched, 0, 'filing paper is not packing boxes');
});

test('printing every artifact leaves the boxes exactly where they were', async () => {
  const { batch, orderId, seasonId } = await batchedOrder();
  const before = await db.package.findMany({ where: { orderId }, orderBy: { id: 'asc' } });

  for (const artifact of PRINT_ARTIFACTS) {
    const rendered = await renderGroupArtifact(null, {
      batchId: batch.id,
      groupId: batch.groups[0].id,
      seasonId,
      artifact,
    });

    assert.equal(rendered.ok, true, `${artifact} renders`);
    assert.ok(rendered.ok && rendered.value.bytes.subarray(0, 4).toString() === '%PDF');
    assert.ok(rendered.ok && rendered.value.fileName.endsWith('.pdf'));
  }

  const order = await renderOrderArtifact(null, { orderId, seasonId, artifact: 'slips' });
  assert.equal(order.ok, true, 'R-056: one order prints its own slip');

  const after = await db.package.findMany({ where: { orderId }, orderBy: { id: 'asc' } });
  assert.deepEqual(
    after.map((box) => [box.stage, box.printedAt, box.sentAt, box.version]),
    before.map((box) => [box.stage, box.printedAt, box.sentAt, box.version]),
    'G-002: paper coming out of a printer moves nothing',
  );

  const groupTrail = await db.auditEvent.count({
    where: { action: 'print.rendered', entityId: batch.groups[0].id },
  });
  const orderTrail = await db.auditEvent.count({
    where: { action: 'print.rendered', entityId: orderId },
  });
  assert.equal(groupTrail, PRINT_ARTIFACTS.length, 'every sheet printed says who printed it');
  assert.equal(orderTrail, 1);
});

test('a bulk stage sweep reports every box, and says so again the same way', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const product = await createProduct(season);
  const method = await createFulfillmentMethod('DELIVERY', 500);
  const staff = await createStaffContext(['fulfillment.manage']);

  const draft = await createDraftOrder({
    season,
    customer,
    lines: [
      { product, fulfillmentMethodId: method.id, recipientName: 'Aaron Zimmer' },
      { product, fulfillmentMethodId: method.id, recipientName: 'Miriam Klein' },
      { product, fulfillmentMethodId: method.id, recipientName: 'Shani Adler' },
    ],
  });
  await finalizeOrder(draft.id, null);

  const ids = (await db.package.findMany({ where: { orderId: draft.id } })).map((box) => box.id);

  const first = await bulkAdvanceStage(staff, { seasonId: season.id, packageIds: ids, stage: 'PACKED' });
  assert.equal(first.applied, 3);
  assert.equal(first.skipped, 0);
  assert.equal(first.conflicts, 0);
  assert.deepEqual(
    first.records.map((record) => record.label),
    ['Aaron Zimmer', 'Miriam Klein', 'Shani Adler'],
    'the report is sorted the way the screen is',
  );

  const second = await bulkAdvanceStage(staff, {
    seasonId: season.id,
    packageIds: [...ids].reverse(),
    stage: 'PACKED',
  });
  assert.equal(second.applied, 0);
  assert.equal(second.skipped, 3, 'boxes a colleague already moved are skipped, not failed');
  assert.deepEqual(
    second.records.map((record) => record.label),
    first.records.map((record) => record.label),
    'the same sweep twice reads the same both times',
  );
});

test('the channel dashboard counts what bulk grouping saved', async () => {
  const season = await createSeason();
  const customer = await createCustomer();
  const product = await createProduct(season);
  const bulk = await createFulfillmentMethod('DELIVERY', 1500, 'PER_DESTINATION');

  const draft = await createDraftOrder({
    season,
    customer,
    lines: [
      { product, fulfillmentMethodId: bulk.id, recipientName: 'Miriam Klein', quantity: 2 },
      { product, fulfillmentMethodId: bulk.id, recipientName: 'Aaron Zimmer' },
    ],
  });
  await finalizeOrder(draft.id, null);

  const { channels } = await readChannelSummaries(season.id);
  const channel = channels.find((row) => row.methodId === bulk.id);

  assert.equal(channel?.packageCount, 2, 'two recipients at one door are still two boxes');
  assert.equal(channel?.itemCount, 3);
  assert.equal(channel?.chargedCents, 1500, 'one drive, one fee');
  assert.equal(channel?.savedCents, 1500, 'the second drive that did not have to happen');
  assert.equal(channel?.stageCounts.NEW, 2);

  const board = await listPackageBoard(
    season.id,
    readBoardFilters({ q: 'klein' }),
    readPageRequest({}),
  );
  assert.equal(board.page.totalCount, 1, 'the board searches by recipient');
  assert.equal(board.rows[0].recipientName, 'Miriam Klein');
  assert.equal(board.rows[0].filedForPrint, false);
});

test('moving lines claims the box they land in, not only the box they leave', async () => {
  const { order } = await placedOrder({ recipients: ['Miriam Klein', 'Miriam Klein'] });

  const original = await db.package.findFirstOrThrow({
    where: { orderId: order.id },
    include: { lines: true },
  });

  const split = await splitPackage(
    { packageId: original.id, expectedVersion: original.version, lineIds: [original.lines[0].id] },
    null,
  );
  assert.equal(split.ok, true);
  if (!split.ok) return;

  const targetBefore = await db.package.findUniqueOrThrow({ where: { id: original.id } });

  const moved = await movePackageLines(
    {
      fromPackageId: split.value.id,
      toPackageId: original.id,
      expectedVersion: split.value.version,
      lineIds: [original.lines[0].id],
    },
    null,
  );
  assert.equal(moved.ok, true);

  const targetAfter = await db.package.findUniqueOrThrow({
    where: { id: original.id },
    include: { lines: true },
  });
  assert.ok(
    targetAfter.version > targetBefore.version,
    'the box that took the lines and the fee moved on too',
  );

  const stale = await splitPackage(
    { packageId: original.id, expectedVersion: targetBefore.version, lineIds: [targetAfter.lines[0].id] },
    null,
  );
  assert.equal(
    stale.ok === false && stale.code,
    STALE_VERSION,
    'a screen drawn before the regroup cannot write over it',
  );
});

test('an order reprint names the pile it replaces, and refuses what the batch refuses', async () => {
  const { batch, orderId, seasonId } = await batchedOrder();
  const otherSeason = await createSeason();

  const stray = await reprintGroup(null, {
    batchId: batch.id,
    groupId: batch.groups[0].id,
    seasonId: otherSeason.id,
  });
  assert.equal(
    stray.ok === false && stray.code,
    PRINT_GROUP_NOT_FOUND,
    'a batch belongs to the season it was built for',
  );

  const reprinted = await reprintOrder(null, { orderId, seasonId });
  assert.equal(reprinted.ok, true);

  const copy = await db.printBatch.findUniqueOrThrow({
    where: { id: reprinted.ok ? reprinted.value.batchId : '' },
  });
  assert.equal(copy.supersedesBatchId, batch.id, 'the reprint says which pile it replaces');

  await db.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } });

  const cancelled = await reprintOrder(null, { orderId, seasonId });
  assert.equal(
    cancelled.ok === false && cancelled.code,
    NOT_PRINTABLE,
    'a cancelled order still has its boxes, and none of them is printed',
  );

  const paper = await renderOrderArtifact(null, { orderId, seasonId, artifact: 'slips' });
  assert.equal(paper.ok === false && paper.code, NOTHING_TO_PRINT, 'and no slip is rendered either');
});

async function placedOrder(input: { recipients: string[] }) {
  const season = await createSeason();
  const customer = await createCustomer();
  const product = await createProduct(season);
  const method = await createFulfillmentMethod('DELIVERY', 500);

  const draft = await createDraftOrder({
    season,
    customer,
    lines: input.recipients.map((recipientName) => ({
      product,
      fulfillmentMethodId: method.id,
      recipientName,
    })),
  });

  const placed = await finalizeOrder(draft.id, null);
  assert.equal(placed.ok, true);

  return { order: draft, season, method };
}

/** A season with one order on two channels, already filed into tonight's batch. */
async function batchedOrder() {
  const season = await createSeason();
  const customer = await createCustomer();
  const product = await createProduct(season);
  const deliver = await createFulfillmentMethod('DELIVERY', 500);
  const shipping = await createFulfillmentMethod('SHIPPING', 0, 'NONE');

  const draft = await createDraftOrder({
    season,
    customer,
    lines: [
      {
        product,
        fulfillmentMethodId: deliver.id,
        recipientName: 'Miriam Klein',
        greetingMessage: 'A freilichen Purim from the Kleins',
      },
      { product, fulfillmentMethodId: shipping.id, recipientName: 'Aaron Zimmer' },
    ],
  });
  await finalizeOrder(draft.id, null);

  const built = await buildNightlyBatch(null, { seasonId: season.id });
  assert.equal(built.ok, true);

  const batch = await readBatch(season.id, built.ok && built.value.batchId ? built.value.batchId : '');
  assert.ok(batch);

  return { batch, orderId: draft.id, seasonId: season.id };
}
