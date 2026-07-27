import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import type { Customer, Package, Season } from '@prisma/client';

import { cronRequestIsAuthorized } from '../src/lib/cron/authorize';
import { finalizeOrder } from '../src/lib/orders/order-service';
import {
  expireUnclaimedPickups,
  listPickupCounter,
  PICKUP_NOT_READY,
  PICKUP_SETTLED,
  sendPickupReady,
  stampPickedUp,
} from '../src/lib/pickup/pickup-service';
import { renderPickupDoorList } from '../src/lib/pickup/pickup-print';
import { toAddressParts } from '../src/lib/addresses/address-mapping';
import { geocodeAddress, milesBetween } from '../src/lib/routing/geocode';
import { forgetNearbySuggestions } from '../src/lib/routing/nearby-suggestions';
import { mapsDirectionsHref } from '../src/lib/routing/maps';
import {
  PACKAGE_NOT_SWITCHABLE,
  switchFulfillmentMethod,
} from '../src/lib/fulfillment/method-switch';
import { NEEDS_CONFIRMATION, NOT_NEARBY, rerouteOntoRoute } from '../src/lib/routing/reroute';
import {
  checkRoutePin,
  findLinkByToken,
  issueRouteLink,
  LINK_EXPIRED,
  PIN_LOCKED,
  PIN_WRONG,
  revokeRouteLink,
} from '../src/lib/routing/route-links';
import { renderRouteArtifact } from '../src/lib/routing/route-print';
import { orderStops } from '../src/lib/routing/route-ordering';
import { buildRoute, markStopDelivered, startRoute } from '../src/lib/routing/route-service';
import { readRouteForAdmin } from '../src/lib/routing/route-view';
import { scheduleBulkDelivery } from '../src/lib/scheduling/bulk-delivery';
import { readFollowUpQueue } from '../src/lib/scheduling/follow-up';
import { sendPaymentReminders } from '../src/lib/scheduling/payment-reminder';
import { buyLabelForPackage } from '../src/lib/shipping/label-service';
import { writeSetting } from '../src/lib/settings';
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

/**
 * Volunteer routes, the driver's link, pickup and the scheduled jobs
 * (UR-004, UR-010, UR-015, G-021, G-023, G-025, G-026, G-027, R-079, R-182).
 *
 * Addresses are placed by the offline geocoder, which is deterministic: the same
 * street always lands in the same spot, so an ordering assertion is stable
 * without a network call. Distances are therefore checked as relationships —
 * nearer, further — rather than as literal miles.
 */
const ORIGIN = {
  name: 'Shipping room',
  line1: '1 Clifton Avenue',
  line2: '',
  city: 'Lakewood',
  state: 'NJ',
  postalCode: '08701',
  phone: '732-555-0100',
};

test('stops come back nearest-first from the shipping room, and unplaced ones go last', () => {
  const origin = { latitude: 40.0, longitude: -74.0 };
  const near = { packageId: 'near', point: { latitude: 40.01, longitude: -74.0 } };
  const middle = { packageId: 'middle', point: { latitude: 40.05, longitude: -74.0 } };
  const far = { packageId: 'far', point: { latitude: 40.2, longitude: -74.0 } };
  const nowhere = { packageId: 'nowhere', point: null };

  const ordered = orderStops([far, nowhere, middle, near], origin);

  assert.deepEqual(
    ordered.map((stop) => stop.packageId),
    ['near', 'middle', 'far', 'nowhere'],
    'the van works outwards and deals with the unplaceable address last',
  );

  assert.ok(
    milesBetween(origin, near.point) < milesBetween(origin, far.point),
    'the distances the ordering is built on really differ',
  );

  // With nowhere to start from the order still has to be total and complete.
  const noOrigin = orderStops([far, near], null);
  assert.equal(noOrigin.length, 2);
});

test('building a route places every stop, and the day-of notice goes once per box', async () => {
  const { season, boxes, staff } = await deliveryOrder(3);

  const built = await buildRoute(staff, {
    seasonId: season.id,
    label: 'Sunday van 1',
    deliveryDay: 'Sunday',
    packageIds: boxes.map((box) => box.id),
  });

  assert.ok(built.ok);
  assert.equal(built.value.stopCount, 3);
  assert.equal(built.value.unplacedCount, 0, 'the offline geocoder places every address');

  const route = await readRouteForAdmin(built.value.routeId, season.id);
  assert.ok(route);
  assert.deepEqual(
    route.stops.map((stop) => stop.sequence),
    [0, 1, 2],
    'sequences are dense and start at zero',
  );
  assert.ok(route.stops.every((stop) => stop.placed));
  assert.ok(route.stops.every((stop) => stop.mapsHref?.includes('google.com/maps')), 'G-030');

  const started = await startRoute(staff, { routeId: route.id, seasonId: season.id });
  assert.ok(started.ok);
  assert.equal(started.value.notified.queued, 3, 'one email per box; no mobile on file for SMS');

  const again = await startRoute(staff, { routeId: route.id, seasonId: season.id });
  assert.ok(again.ok);
  assert.equal(again.value.notified.queued, 0, 'pressing Start twice does not text anybody twice');
  assert.equal(again.value.notified.alreadySent, 3);

  const running = await db.deliveryRoute.findUniqueOrThrow({ where: { id: route.id } });
  assert.equal(running.status, 'IN_PROGRESS');
  assert.ok(running.startedAt);

  const audit = await db.auditEvent.findFirstOrThrow({
    where: { action: 'route.started', entityId: route.id },
  });
  assert.equal((audit.detail as { notified: number }).notified, 3);
});

test('the last stop closes the route, sends the box, and kills the link', async () => {
  const { season, boxes, staff } = await deliveryOrder(2);

  const built = await buildRoute(staff, {
    seasonId: season.id,
    label: 'Monday van',
    deliveryDay: 'Monday',
    packageIds: boxes.map((box) => box.id),
  });
  assert.ok(built.ok);

  const issued = await issueRouteLink(staff, {
    routeId: built.value.routeId,
    seasonId: season.id,
    withPin: false,
  });
  assert.ok(issued.ok);

  const route = await readRouteForAdmin(built.value.routeId, season.id);
  assert.ok(route);

  const first = await markStopDelivered(null, {
    routeId: route.id,
    stopId: route.stops[0].id,
    linkId: issued.value.linkId,
    seasonId: null,
  });

  assert.ok(first.ok);
  assert.equal(first.value.remaining, 1);
  assert.equal(first.value.routeCompleted, false);

  const sentBox = await db.package.findUniqueOrThrow({ where: { id: route.stops[0].packageId } });
  assert.equal(sentBox.stage, 'SENT', 'a box off the van is a box that has gone out');
  assert.ok(sentBox.sentAt);

  // Tapping Delivered twice is a driver reloading a page on a bad signal.
  const replay = await markStopDelivered(null, {
    routeId: route.id,
    stopId: route.stops[0].id,
    linkId: issued.value.linkId,
    seasonId: null,
  });
  assert.ok(replay.ok);
  assert.equal(replay.value.remaining, 1, 'the second tap changes nothing');

  const last = await markStopDelivered(null, {
    routeId: route.id,
    stopId: route.stops[1].id,
    linkId: issued.value.linkId,
    seasonId: null,
  });
  assert.ok(last.ok);
  assert.equal(last.value.routeCompleted, true);

  const finished = await db.deliveryRoute.findUniqueOrThrow({ where: { id: route.id } });
  assert.equal(finished.status, 'COMPLETED');
  assert.ok(finished.completedAt);

  const link = await db.driverRouteLink.findUniqueOrThrow({ where: { id: issued.value.linkId } });
  assert.ok(link.expiresAt.getTime() - Date.now() < 20 * 60 * 1000, 'the link is on a short fuse');

  const deliveries = await db.auditEvent.findMany({
    where: { action: 'route.stop_delivered', entityId: { in: route.stops.map((stop) => stop.id) } },
  });
  assert.equal(deliveries.length, 2, 'one row per stop, not one per tap');
  assert.ok(
    deliveries.every((row) => (row.detail as { source: string }).source === 'driver_link'),
    'G-025: the trail says the driver did it, not the office',
  );
});

test('a driver link is unguessable, throttled, and dead the moment it is revoked', async () => {
  const { season, boxes, staff } = await deliveryOrder(1);

  const built = await buildRoute(staff, {
    seasonId: season.id,
    label: 'PIN van',
    deliveryDay: null,
    packageIds: boxes.map((box) => box.id),
  });
  assert.ok(built.ok);

  const issued = await issueRouteLink(staff, {
    routeId: built.value.routeId,
    seasonId: season.id,
    withPin: true,
  });
  assert.ok(issued.ok);
  assert.match(issued.value.pin ?? '', /^\d{4}$/);
  assert.ok(issued.value.token.length >= 40, 'the token is 32 random bytes, not an id');

  const stored = await db.driverRouteLink.findUniqueOrThrow({ where: { id: issued.value.linkId } });
  assert.ok(!stored.tokenHash.includes(issued.value.token), 'only the hash is kept');
  assert.ok(stored.pinHash && !stored.pinHash.includes(issued.value.pin ?? ''));

  assert.ok(await findLinkByToken(issued.value.token));
  assert.equal(await findLinkByToken('not-a-real-token'), null);

  const wrongPin = issued.value.pin === '0000' ? '1111' : '0000';

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const refused = await checkRoutePin(issued.value.linkId, wrongPin);
    assert.equal(refused.ok === false && refused.code, PIN_WRONG, `attempt ${attempt}`);
  }

  const locked = await checkRoutePin(issued.value.linkId, wrongPin);
  assert.equal(locked.ok === false && locked.code, PIN_LOCKED, 'five wrong tries locks it');

  const lockedOut = await checkRoutePin(issued.value.linkId, issued.value.pin ?? '');
  assert.equal(lockedOut.ok === false && lockedOut.code, PIN_LOCKED, 'the right PIN waits too');

  await db.driverRouteLink.update({
    where: { id: issued.value.linkId },
    data: { lockedUntil: null },
  });

  const opened = await checkRoutePin(issued.value.linkId, issued.value.pin ?? '');
  assert.ok(opened.ok);

  const revoked = await revokeRouteLink(staff, { routeId: built.value.routeId, seasonId: season.id });
  assert.ok(revoked.ok);
  assert.equal(revoked.value.revoked, 1);
  assert.equal(await findLinkByToken(issued.value.token), null, 'UR-015');

  const afterRevoke = await checkRoutePin(issued.value.linkId, issued.value.pin ?? '');
  assert.equal(afterRevoke.ok === false && afterRevoke.code, LINK_EXPIRED);

  // Issuing a second link retires the first, so a link sent to the wrong phone
  // stops working the moment the office reissues.
  const first = await issueRouteLink(staff, {
    routeId: built.value.routeId,
    seasonId: season.id,
    withPin: false,
  });
  assert.ok(first.ok);

  const second = await issueRouteLink(staff, {
    routeId: built.value.routeId,
    seasonId: season.id,
    withPin: false,
  });
  assert.ok(second.ok);
  assert.equal(await findLinkByToken(first.value.token), null);
  assert.ok(await findLinkByToken(second.value.token));
});

test('switching a box onto a van cancels its label and never re-prices the customer', async () => {
  const { season, box, staff, deliveryMethodId } = await shippedBox();
  const feeBefore = box.fulfillmentFeeCents;

  const bought = await buyLabelForPackage(db, staff, { packageId: box.id, seasonId: season.id });
  assert.ok(bought.ok);

  await db.package.update({ where: { id: box.id }, data: { stage: 'PRINTED' } });
  const printed = await db.package.findUniqueOrThrow({ where: { id: box.id } });

  const switched = await switchFulfillmentMethod(staff, {
    packageId: box.id,
    seasonId: season.id,
    toMethodId: deliveryMethodId,
    expectedVersion: printed.version,
    reason: 'A volunteer is passing the door',
  });

  assert.ok(switched.ok);
  assert.equal(switched.value.labelVoided, true);

  const moved = await db.package.findUniqueOrThrow({
    where: { id: box.id },
    include: { fulfillmentMethod: true, lines: true },
  });

  assert.equal(moved.fulfillmentMethodId, deliveryMethodId);
  assert.equal(moved.fulfillmentFeeCents, feeBefore, 'G-028: what they agreed to pay is untouched');
  assert.ok(
    moved.lines.every((line) => line.fulfillmentMethodId === deliveryMethodId),
    'the lines carry the method too, or the grouping key disagrees with the box',
  );

  const parcel = await db.shipmentBox.findFirstOrThrow({ where: { packageId: box.id } });
  assert.equal(parcel.status, 'VOIDED', 'the P8 void hook ran');
  assert.ok(parcel.voidReason?.includes('volunteer'));

  const audit = await db.auditEvent.findFirstOrThrow({
    where: { action: 'package.method_switched', entityId: box.id },
  });
  assert.equal((audit.detail as { feeCents: number }).feeCents, feeBefore);
  assert.equal((audit.detail as { labelVoided: boolean }).labelVoided, true);

  // A box that has gone out is settled, whatever the office would rather do.
  await db.package.update({ where: { id: box.id }, data: { stage: 'SENT' } });
  const settled = await db.package.findUniqueOrThrow({ where: { id: box.id } });

  const tooLate = await switchFulfillmentMethod(staff, {
    packageId: box.id,
    seasonId: season.id,
    toMethodId: deliveryMethodId,
    expectedVersion: settled.version,
    reason: 'too late',
  });
  assert.equal(tooLate.ok === false && tooLate.code, PACKAGE_NOT_SWITCHABLE);
});

test('a reroute onto a van needs somebody to confirm it, and then joins the route', async () => {
  const { season, box, staff, deliveryMethodId } = await shippedBox();
  const neighbour = await db.package.findUniqueOrThrow({ where: { id: box.id } });

  const route = await buildRoute(staff, {
    seasonId: season.id,
    label: 'Reroute van',
    deliveryDay: null,
    packageIds: [await routableSibling(season, staff, deliveryMethodId)],
  });
  assert.ok(route.ok);

  const unconfirmed = await rerouteOntoRoute(staff, {
    routeId: route.value.routeId,
    packageId: box.id,
    seasonId: season.id,
    toMethodId: deliveryMethodId,
    expectedVersion: neighbour.version,
    confirmed: false,
  });

  assert.equal(unconfirmed.ok === false && unconfirmed.code, NEEDS_CONFIRMATION);
  assert.equal(
    await db.routeStop.count({ where: { routeId: route.value.routeId } }),
    1,
    'nothing was added on a suggestion nobody accepted',
  );

  // A confirmation is not enough on its own: the post can name any box, so the
  // van has to really be passing it. Half a degree is about thirty miles away.
  await pinStopNear(route.value.routeId, box.id, 0.5);

  const tooFar = await rerouteOntoRoute(staff, {
    routeId: route.value.routeId,
    packageId: box.id,
    seasonId: season.id,
    toMethodId: deliveryMethodId,
    expectedVersion: neighbour.version,
    confirmed: true,
  });

  assert.equal(tooFar.ok === false && tooFar.code, NOT_NEARBY);
  assert.equal(
    await db.routeStop.count({ where: { routeId: route.value.routeId } }),
    1,
    'a box across the county is not lifted off the carrier',
  );

  await pinStopNear(route.value.routeId, box.id, 0.001);

  const confirmed = await rerouteOntoRoute(staff, {
    routeId: route.value.routeId,
    packageId: box.id,
    seasonId: season.id,
    toMethodId: deliveryMethodId,
    expectedVersion: neighbour.version,
    confirmed: true,
  });

  assert.ok(confirmed.ok);

  const stops = await db.routeStop.findMany({
    where: { routeId: route.value.routeId },
    orderBy: { sequence: 'asc' },
  });
  assert.equal(stops.length, 2);
  assert.equal(stops[1].packageId, box.id, 'a rerouted box is appended, not inserted mid-run');

  const printed = await renderRouteArtifact(staff, {
    routeId: route.value.routeId,
    seasonId: season.id,
    artifact: 'sheet',
  });
  assert.ok(printed.ok);
  assert.ok(printed.value.bytes.length > 0, 'the sheet is regenerated with the new stop on it');
});

test('a pickup box is only announced when the food is on the shelf, and holds for a week', async () => {
  const { season, box, customer, staff } = await pickupBox();

  const early = await sendPickupReady(staff, { packageId: box.id, seasonId: season.id });
  assert.equal(early.ok === false && early.code, PICKUP_NOT_READY, 'G-017: nothing is packed yet');
  assert.equal(await db.notificationLog.count({ where: { packageId: box.id } }), 0);

  const unpacked = await listPickupCounter(season.id);
  const waiting = unpacked.find((candidate) => candidate.id === box.id);
  assert.deepEqual(waiting?.blockedBy, ['not packed yet'], 'the row says what is in the way');

  await db.package.update({ where: { id: box.id }, data: { stage: 'PACKED' } });

  // Stock counted down after the order was placed: the shelf no longer covers
  // what was promised, which is the other half of the eligibility question. The
  // hold goes with it, because the table refuses to reserve stock that is gone.
  await db.$executeRaw`
    UPDATE "InventoryItem" SET "onHand" = 0, "reserved" = 0
    WHERE "productId" IN (SELECT "productId" FROM "OrderLine" WHERE "packageId" = ${box.id})`;

  const short = await sendPickupReady(staff, { packageId: box.id, seasonId: season.id });
  assert.equal(short.ok === false && short.code, PICKUP_NOT_READY, 'G-017: the shelf is empty');
  assert.ok(short.ok === false && short.publicMessage.includes('short of'));

  await db.inventoryItem.updateMany({
    where: { product: { orderLines: { some: { packageId: box.id } } } },
    data: { onHand: 10 },
  });

  const told = await sendPickupReady(staff, { packageId: box.id, seasonId: season.id });
  assert.ok(told.ok);
  assert.equal(told.value.outbox.queued, 1);

  const stamped = await db.package.findUniqueOrThrow({ where: { id: box.id } });
  assert.ok(stamped.pickupReadyAt);
  assert.ok(stamped.pickupExpiresAt);
  assert.ok(
    stamped.pickupExpiresAt.getTime() - stamped.pickupReadyAt.getTime() > 6 * 24 * 60 * 60 * 1000,
    'G-026: a week on the shelf, not an afternoon',
  );

  const twice = await sendPickupReady(staff, { packageId: box.id, seasonId: season.id });
  assert.ok(twice.ok);
  assert.equal(twice.value.outbox.queued, 0, 'nobody is told twice');
  assert.equal(twice.value.outbox.alreadySent, 1);

  const doorList = await renderPickupDoorList(staff, {
    seasonId: season.id,
    seasonLabel: season.label,
  });
  assert.ok(doorList.ok, 'the door list has the waiting box on it');

  // Nobody came, so the sweep stamps it — and the box stays collectable.
  await db.package.update({
    where: { id: box.id },
    data: { pickupExpiresAt: new Date(Date.now() - 1000) },
  });

  const swept = await expireUnclaimedPickups();
  assert.ok(swept.expired >= 1);

  const run = await db.cronRunLog.findFirstOrThrow({
    where: { jobName: 'pickup.expiry-sweep' },
    orderBy: { startedAt: 'desc' },
  });
  assert.equal(run.status, 'SUCCEEDED', 'R-182: every job leaves a row saying what it did');

  const chased = await readFollowUpQueue(season.id, { reason: 'pickup_unclaimed', search: '' });
  assert.ok(
    chased.some((call) => call.customerName === customer.fullName),
    'R-079: an unclaimed box becomes a phone call',
  );

  const collected = await stampPickedUp(staff, { packageId: box.id, seasonId: season.id });
  assert.ok(collected.ok);

  const home = await db.package.findUniqueOrThrow({ where: { id: box.id } });
  assert.equal(home.stage, 'PICKED_UP');
  assert.equal(home.pickupExpiredAt, null, 'collecting it clears the "nobody came" stamp');

  const twiceCollected = await stampPickedUp(staff, { packageId: box.id, seasonId: season.id });
  assert.equal(twiceCollected.ok === false && twiceCollected.code, PICKUP_SETTLED);
});

test('bulk scheduling writes one message per customer, not one per box', async () => {
  const { season, boxes, staff } = await deliveryOrder(3);

  const scheduled = await scheduleBulkDelivery(staff, {
    seasonId: season.id,
    packageIds: boxes.map((box) => box.id),
    deliveryDay: 'Sunday',
    deliveryWindow: '10am and 2pm',
  });

  assert.ok(scheduled.ok);
  assert.equal(scheduled.value.packageCount, 3);
  assert.equal(scheduled.value.customerCount, 1, 'G-021: three boxes, one donor, one message');
  assert.equal(scheduled.value.outbox.queued, 1, 'the email; there is no mobile on file');

  const written = await db.package.findMany({ where: { id: { in: boxes.map((box) => box.id) } } });
  assert.ok(written.every((box) => box.deliveryDay === 'Sunday'));
  assert.ok(written.every((box) => box.deliveryWindow === '10am and 2pm'));

  const replay = await scheduleBulkDelivery(staff, {
    seasonId: season.id,
    packageIds: boxes.map((box) => box.id),
    deliveryDay: 'Sunday',
    deliveryWindow: '10am and 2pm',
  });
  assert.ok(replay.ok);
  assert.equal(replay.value.outbox.queued, 0, 'the same slot does not send again');

  const moved = await scheduleBulkDelivery(staff, {
    seasonId: season.id,
    packageIds: boxes.map((box) => box.id),
    deliveryDay: 'Monday',
    deliveryWindow: '10am and 2pm',
  });
  assert.ok(moved.ok);
  assert.equal(moved.value.outbox.queued, 1, 'a different day is news, so it does send');
});

test('the payment reminder job chases overdue orders once and logs its run', async () => {
  const { season, order, customer } = await deliveryOrder(1);

  await db.order.update({
    where: { id: order.id },
    data: {
      placedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      paymentStatus: 'UNPAID',
      amountPaidCents: 0,
    },
  });

  const first = await sendPaymentReminders();
  assert.ok(first.orders >= 1);
  assert.ok(first.outbox.queued >= 1);

  const again = await sendPaymentReminders();
  assert.equal(again.outbox.queued, 0, 'R-080: one reminder a day, not one a run');

  const run = await db.cronRunLog.findFirstOrThrow({
    where: { jobName: 'payment.reminder-sweep' },
    orderBy: { startedAt: 'desc' },
  });
  assert.equal(run.status, 'SUCCEEDED');

  const owed = await readFollowUpQueue(season.id, { reason: 'unpaid', search: '' });
  assert.ok(owed.some((call) => call.customerName === customer.fullName));
  assert.ok(owed.every((call) => call.owedCents > 0), 'the list says what they owe');
});

test('a cron endpoint answers nothing without the shared secret', () => {
  const secret = process.env.CRON_SECRET ?? '';
  assert.notEqual(secret, '', 'the test environment configures one');

  const withSecret = new Request('http://localhost/api/cron/pickup-expiry', {
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(cronRequestIsAuthorized(withSecret), true);

  const bare = new Request('http://localhost/api/cron/pickup-expiry');
  assert.equal(cronRequestIsAuthorized(bare), false);

  const wrong = new Request('http://localhost/api/cron/pickup-expiry', {
    headers: { authorization: `Bearer ${secret}x` },
  });
  assert.equal(cronRequestIsAuthorized(wrong), false, 'a near miss is still a miss');

  const basic = new Request('http://localhost/api/cron/pickup-expiry', {
    headers: { authorization: `Basic ${secret}` },
  });
  assert.equal(cronRequestIsAuthorized(basic), false);
});

test('a driver is sent to the right house by a link the phone already knows how to open', () => {
  const href = mapsDirectionsHref({
    line1: '88 Yeshiva Lane',
    line2: 'Apt 2',
    city: 'Monsey',
    state: 'NY',
    postalCode: '10952',
    country: 'US',
  });

  assert.ok(href.startsWith('https://www.google.com/maps/dir/?api=1'), 'G-030');
  assert.ok(href.includes('Yeshiva'));
  assert.ok(href.includes('10952'));
});

/** One placed order with `count` delivery boxes for a single customer. */
async function deliveryOrder(count: number): Promise<{
  season: Season;
  order: { id: string };
  customer: Customer;
  boxes: Package[];
  staff: Awaited<ReturnType<typeof createStaffContext>>;
}> {
  const season = await createSeason();
  const customer = await createCustomer(`Donor ${Date.now()}`);
  const product = await createProduct(season);
  const method = await createFulfillmentMethod('DELIVERY', 0);
  const staff = await createStaffContext(['routes.manage', 'fulfillment.manage']);

  await writeSetting('shipping.origin', ORIGIN);

  const draft = await createDraftOrder({
    season,
    customer,
    lines: Array.from({ length: count }, (_unused, index) => ({
      product,
      fulfillmentMethodId: method.id,
      recipientName: `Recipient ${index + 1}`,
      addressLine1: `${(index + 1) * 11} Forest Avenue`,
    })),
  });

  const placed = await finalizeOrder(draft.id, null);
  assert.equal(placed.ok, true);

  const boxes = await db.package.findMany({ where: { orderId: draft.id }, orderBy: { recipientName: 'asc' } });
  assert.equal(boxes.length, count, 'one box per recipient');

  return { season, order: draft, customer, boxes, staff };
}

/** A placed shipping box with a delivery channel alongside it to switch onto. */
async function shippedBox(): Promise<{
  season: Season;
  box: Package;
  staff: Awaited<ReturnType<typeof createStaffContext>>;
  deliveryMethodId: string;
}> {
  const season = await createSeason();
  const customer = await createCustomer();
  const product = await measuredProduct(season);
  const shipping = await createFulfillmentMethod('SHIPPING', 1200);
  const delivery = await createFulfillmentMethod('DELIVERY', 0);
  const staff = await createStaffContext(['routes.manage', 'fulfillment.manage']);

  await stockBoxTypes();
  await writeSetting('shipping.origin', ORIGIN);

  const draft = await createDraftOrder({
    season,
    customer,
    lines: [
      {
        product,
        fulfillmentMethodId: shipping.id,
        recipientName: 'Aaron Zimmer',
        addressLine1: '88 Yeshiva Lane',
      },
    ],
  });

  const placed = await finalizeOrder(draft.id, null);
  assert.equal(placed.ok, true);

  const box = await db.package.findFirstOrThrow({ where: { orderId: draft.id } });
  return { season, box, staff, deliveryMethodId: delivery.id };
}

/**
 * Moves a route's stops a fixed distance from where a box geocodes to.
 *
 * The offline geocoder scatters addresses by hash, so two houses on one street
 * are not reliably neighbours. Pinning the stop makes "the van is passing this
 * box" a stated fact of the test rather than a coincidence of the digest.
 */
async function pinStopNear(
  routeId: string,
  packageId: string,
  degreesAway: number,
): Promise<void> {
  const box = await db.package.findUniqueOrThrow({ where: { id: packageId } });
  const address = toAddressParts(box);
  assert.ok(address);

  const answer = await geocodeAddress(address);
  assert.ok(answer.point);

  await db.routeStop.updateMany({
    where: { routeId },
    data: {
      latitude: answer.point.latitude + degreesAway,
      longitude: answer.point.longitude,
    },
  });

  forgetNearbySuggestions(routeId);
}

/** A second placed delivery box in the same season, to give a route a stop. */
async function routableSibling(
  season: Season,
  staff: Awaited<ReturnType<typeof createStaffContext>>,
  deliveryMethodId: string,
): Promise<string> {
  const customer = await createCustomer();
  const product = await createProduct(season);

  const draft = await createDraftOrder({
    season,
    customer,
    lines: [
      {
        product,
        fulfillmentMethodId: deliveryMethodId,
        recipientName: 'Neighbour',
        addressLine1: '90 Yeshiva Lane',
      },
    ],
  });

  const placed = await finalizeOrder(draft.id, null);
  assert.equal(placed.ok, true);
  assert.ok(staff.actor.id);

  const box = await db.package.findFirstOrThrow({ where: { orderId: draft.id } });
  return box.id;
}

async function pickupBox(): Promise<{
  season: Season;
  box: Package;
  customer: Customer;
  staff: Awaited<ReturnType<typeof createStaffContext>>;
}> {
  const season = await createSeason();
  const customer = await createCustomer(`Collector ${Date.now()}`);
  const product = await createProduct(season);
  const location = await createPickupLocation();
  const staff = await createStaffContext(['fulfillment.manage']);

  const method = await db.fulfillmentMethod.create({
    data: {
      code: `pickup-${Date.now()}`,
      label: 'Test pickup',
      kind: 'PICKUP',
      requiresAddress: false,
      requiresPickupLocation: true,
    },
  });

  const draft = await createDraftOrder({
    season,
    customer,
    lines: [{ product, fulfillmentMethodId: method.id, recipientName: 'Collector' }],
  });

  await db.orderLine.updateMany({
    where: { orderId: draft.id },
    data: { pickupLocationId: location.id },
  });

  const placed = await finalizeOrder(draft.id, null);
  assert.equal(placed.ok, true);

  const box = await db.package.findFirstOrThrow({ where: { orderId: draft.id } });
  return { season, box, customer, staff };
}

async function measuredProduct(season: Season) {
  const product = await createProduct(season);

  return db.product.update({
    where: { id: product.id },
    data: { lengthMm: 300, widthMm: 220, heightMm: 120, weightGrams: 1400 },
  });
}

async function stockBoxTypes(): Promise<void> {
  const types = [
    { name: 'Small box', lengthMm: 320, widthMm: 240, heightMm: 140, maxWeightGrams: 5000 },
    { name: 'Large box', lengthMm: 460, widthMm: 360, heightMm: 260, maxWeightGrams: 15000 },
  ];

  for (const type of types) {
    await db.packageType.upsert({ where: { name: type.name }, create: type, update: {} });
  }
}
