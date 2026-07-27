import { PrismaClient } from '@prisma/client';

import { DATABASE_URL, TEST_DATABASE_URL } from './db-server';
import { parseForms, Session } from './http-form';
import { envWithoutDatabaseUrl, runCommand, runTests, SmokeRun } from './smoke-harness';
import { formWith, redirectOf } from './smoke-p4-helpers';

/**
 * Phase P9 smoke run: vans, driver links, pickup and the scheduled jobs.
 *
 * The run drives a real Purim afternoon end to end over HTTP: the office builds
 * a route out of boxes it just sold, hands a volunteer a link, the volunteer
 * opens it on a phone with a PIN and taps Delivered, a shipping box next door is
 * lifted onto the van with its label cancelled, the counter tells a family their
 * box is ready, and the cron endpoints refuse anybody without the shared secret.
 *
 * Addresses are placed by the offline geocoder (no MAPBOX_ACCESS_TOKEN), which
 * puts the same address in the same spot every time — so a neighbour at the same
 * street address is genuinely zero miles from the stop, which is what makes the
 * reroute suggestion deterministic rather than lucky.
 *
 * Expects `npm run dev` up on 3104 against the seeded database.
 */
const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3104';

const MANAGER_EMAIL = 'manager@tomchei.example';
const DRIVER_EMAIL = 'driver@tomchei.example';

const CLASSIC = 'classic-mishloach-manos';
const BOARD = '/admin/fulfillment/packages';
const ROUTES = '/admin/routes';
const PICKUP = '/admin/pickup';

const HOUSES = [
  { recipientName: 'Rivka Adler', line1: '12 Forest Avenue', city: 'Lakewood', state: 'NJ', postalCode: '08701' },
  { recipientName: 'Yosef Brand', line1: '46 Cedarbridge Road', city: 'Lakewood', state: 'NJ', postalCode: '08701' },
  { recipientName: 'Chana Diamond', line1: '77 Squankum Road', city: 'Lakewood', state: 'NJ', postalCode: '08701' },
];

const TEST_FILES = ['tests/routes.test.ts'];

const db = new PrismaClient({ datasourceUrl: DATABASE_URL });

const run = new SmokeRun('P9', [
  `Run at ${new Date().toISOString()} against ${BASE_URL} (web 3104, db 4104).`,
  'Addresses are placed by the offline geocoder, which is deterministic: the same',
  'house always lands in the same spot, so the half-mile reroute rule is testable.',
]);

const record = run.record.bind(run);
const expect = run.expect.bind(run);
const expectTest = run.expectTest.bind(run);

/** The season's first delivery day, filled in before anything is sold. */
let DELIVERY_DAY = '';

async function main() {
  DELIVERY_DAY = await firstDeliveryDay();

  const methods = await db.fulfillmentMethod.findMany({ where: { isActive: true } });
  const deliverId = methods.find((row) => row.code === 'deliver')!.id;
  const shipId = methods.find((row) => row.code === 'ship')!.id;
  const pickupId = methods.find((row) => row.code === 'pickup')!.id;
  const pickupLocation = await db.pickupLocation.findFirstOrThrow();

  await db.order.deleteMany({ where: { status: 'DRAFT', posStaffUserId: { not: null } } });

  const manager = new Session(BASE_URL);
  await signInStaff(manager, MANAGER_EMAIL);

  // ------------------------------------------------------- S1 the route is built
  const donorEmail = `routes-${Date.now()}@example.test`;
  const { orderId } = await sellAtCounter(manager, donorEmail, 'Route Donor', [
    { slug: CLASSIC, methodId: deliverId, ...HOUSES[0] },
    { slug: CLASSIC, methodId: deliverId, ...HOUSES[1] },
    { slug: CLASSIC, methodId: deliverId, ...HOUSES[2] },
  ]);

  const boxes = await db.package.findMany({ where: { orderId }, orderBy: { recipientName: 'asc' } });

  const routesPage = await manager.get(ROUTES);
  const buildForm = formWith(routesPage.body, ROUTES, 'data-testid="build-route"');
  const buildLocation = redirectOf(
    await manager.submit(buildForm, {
      intent: 'build',
      label: `Smoke van ${Date.now()}`,
      deliveryDay: DELIVERY_DAY,
      packageIds: boxes.map((box) => box.id),
    }),
    'building the route',
  );

  const routePath = new URL(buildLocation, BASE_URL).pathname;
  const routeId = routePath.split('/').pop() ?? '';
  const route = await db.deliveryRoute.findUniqueOrThrow({
    where: { id: routeId },
    include: { stops: { orderBy: { sequence: 'asc' }, include: { package: true } } },
  });

  const origin = (await db.setting.findUniqueOrThrow({ where: { key: 'shipping.origin' } })).value as {
    postalCode: string;
  };

  expect('S1a', 'A route is built from ticked boxes, every stop placed on the map and put in driving order',
    route.stops.length === 3 &&
      route.stops.every((stop) => stop.latitude !== null && stop.longitude !== null) &&
      route.stops.map((stop) => stop.sequence).join(',') === '0,1,2',
    `R-074, R-075: ${route.stops.length} stops geocoded from the shipping room in ${origin.postalCode} and sequenced ${route.stops.map((stop) => stop.package.recipientName).join(' → ')}`);

  // ------------------------------------------------------ S1 the driver's key
  const detail = await manager.get(routePath);
  const assigned = redirectOf(
    await manager.submit(formWith(detail.body, routePath, 'data-testid="assign-driver"'), {
      driverStaffUserId: (await db.staffUser.findFirstOrThrow({ where: { email: DRIVER_EMAIL } })).id,
    }),
    'assigning the driver',
  );

  const issueForm = formWith((await manager.get(routePath)).body, routePath, 'data-testid="issue-link"');
  // Nothing is ticked: a PIN is what the office gets unless it asks to go without.
  const issuedLocation = redirectOf(await manager.submit(issueForm), 'issuing the link');
  const linkPath = flashValue(issuedLocation, 'linkPath');
  const pin = flashValue(issuedLocation, 'linkPin');
  const token = linkPath.split('/').pop() ?? '';

  const linkRow = await db.driverRouteLink.findFirstOrThrow({
    where: { routeId, revokedAt: null },
  });

  expect('S1b', 'The driver link is a random token the database never stores, with a PIN it never stores either',
    token.length >= 40 &&
      /^\d{4}$/.test(pin) &&
      !linkRow.tokenHash.includes(token) &&
      linkRow.pinHash !== null &&
      !linkRow.pinHash.includes(pin),
    `UR-015, G-025: assigned (${flashValue(assigned, 'notice')}) and issued a ${token.length}-character token whose SHA-256 is what is kept, plus a 4-digit PIN — asked for by nobody, because a link to somebody's front door is PIN-locked unless the office opts out`);

  const stranger = new Session(BASE_URL);
  const guessed = await stranger.get('/drive/not-a-real-token-at-all');
  const gate = await stranger.get(linkPath);

  expect('S1c', 'A guessed token and a real one before the PIN both reach nothing but a form',
    guessed.status === 200 &&
      guessed.body.includes('data-testid="driver-link-dead"') &&
      gate.body.includes('data-testid="driver-pin-gate"') &&
      !gate.body.includes('data-testid="driver-stop"'),
    `a token nobody issued answers "this link is not live" with no hint that routes exist, and the real link shows only the PIN form — no stop, no address, no name`);

  const wrongPin = pin === '0000' ? '1111' : '0000';
  const refused = flashValue(
    await stranger.submit(formWith(gate.body, linkPath, 'data-testid="driver-pin-submit"'), { pin: wrongPin }),
    'problem',
    true,
  );

  const opened = await stranger.submit(
    formWith((await stranger.get(linkPath)).body, linkPath, 'data-testid="driver-pin-submit"'),
    { pin },
  );
  redirectOf(opened, 'answering the PIN');

  const phone = await stranger.get(linkPath);
  const otherRoutes = await db.deliveryRoute.count({ where: { id: { not: routeId } } });

  expect('S1d', 'A wrong PIN is counted and refused; the right one opens this route and nothing else',
    refused.includes('not right') &&
      phone.body.includes('data-testid="driver-stops"') &&
      countOf(phone.body, 'data-testid="driver-stop"') === 3 &&
      route.stops.every((stop) => phone.body.includes(stop.package.recipientName)) &&
      !/<a\b[^>]*href="\/admin/.test(phone.body),
    `"${refused}" — then the right PIN shows exactly this route's 3 stops out of ${otherRoutes + 1} routes in the database, with no admin link anywhere on the page`);

  expect('S2a', 'Every stop carries a Google Maps deep link with the address in it',
    countOf(phone.body, 'data-testid="driver-maps-link"') === 3 &&
      phone.body.includes('google.com/maps/dir/') &&
      phone.body.includes(encodeURIComponent(HOUSES[0].line1).replace(/%20/g, '+')),
    `G-030: 3 Directions links, each addressed to the house rather than to a coordinate — ${HOUSES[0].line1} is in the query string`);

  // ----------------------------------------------- S4 the van pulls out
  const started = flashValue(
    await manager.submit(formWith((await manager.get(routePath)).body, routePath, 'data-testid="start-route"')),
    'notice',
  );
  const startedAgain = flashValue(
    await manager.submit(formWith((await manager.get(routePath)).body, routePath, 'data-testid="start-route"')),
    'notice',
  );

  const dayOf = await db.notificationLog.findMany({
    where: { routeId, kind: 'delivery.day_of' },
  });

  expect('S4a', 'Starting the route tells every recipient once, and pressing it again tells nobody twice',
    dayOf.length === 3 &&
      started.includes('3 sent') &&
      startedAgain.includes('0 sent') &&
      startedAgain.includes('3 already had one'),
    `G-023: "${started}" then "${startedAgain}" — ${dayOf.length} day-of notices, one per box, keyed on the box so a second tap is a no-op`);

  // ------------------------------------------------- S1/S2 delivering the run
  const firstStop = route.stops[0];
  const tapped = flashValue(
    await stranger.submit(
      formWith((await stranger.get(linkPath)).body, linkPath, 'data-testid="driver-delivered"'),
      { stopId: firstStop.id },
    ),
    'notice',
  );

  const deliveredStop = await db.routeStop.findUniqueOrThrow({ where: { id: firstStop.id } });
  const deliveredBox = await db.package.findUniqueOrThrow({ where: { id: firstStop.packageId } });
  const tapAudit = await db.auditEvent.findFirstOrThrow({
    where: { action: 'route.stop_delivered', entityId: firstStop.id },
  });

  expect('S1e', 'A Delivered tap sends the box and leaves an audit row naming the link that made it',
    deliveredStop.status === 'DELIVERED' &&
      deliveredStop.deliveredByLinkId === linkRow.id &&
      deliveredBox.stage === 'SENT' &&
      (tapAudit.detail as { linkId: string; source: string }).linkId === linkRow.id &&
      (tapAudit.detail as { source: string }).source === 'driver_link',
    `"${tapped}" — ${deliveredBox.recipientName} stamped at ${deliveredStop.deliveredAt?.toISOString()} by link ${linkRow.id}, and the box is Sent (G-025)`);

  const sheet = await manager.request(`${routePath}/print/sheet`);
  const sheetBytes = Buffer.from(await sheet.arrayBuffer());
  const cards = await manager.request(`${routePath}/print/cards`);

  expect('S2b', 'The printed fallback carries the same run: every stop, in order, with a box to tick',
    sheet.status === 200 &&
      sheet.headers.get('content-type') === 'application/pdf' &&
      sheetBytes.subarray(0, 4).toString() === '%PDF' &&
      sheetBytes.includes(Buffer.from('[  ]')) &&
      route.stops.every((stop) => sheetBytes.includes(Buffer.from(stop.package.recipientName))) &&
      cards.status === 200,
    `UR-013, R-076: a ${sheetBytes.length}-byte PDF with tick boxes and all 3 recipients on it, plus this run's greeting cards — a phone with no signal is not a stopped van`);

  // The office finishes the run off the sheet, which has to leave the same trail.
  for (const stop of route.stops.slice(1)) {
    const page = await manager.get(routePath);
    const form = parseForms(page.body, routePath).find((candidate) => candidate.fields.stopId === stop.id);
    if (!form) throw new Error(`No Mark delivered form for stop ${stop.id}`);
    await manager.submit(form);
  }

  const finished = await db.deliveryRoute.findUniqueOrThrow({ where: { id: routeId } });
  const deadLink = await db.driverRouteLink.findUniqueOrThrow({ where: { id: linkRow.id } });
  const officeTaps = await db.auditEvent.findMany({
    where: {
      action: 'route.stop_delivered',
      entityId: { in: route.stops.slice(1).map((stop) => stop.id) },
    },
  });

  expect('S2c', 'A route finished off the printed sheet closes itself and puts the link on a short fuse',
    finished.status === 'COMPLETED' &&
      finished.completedAt !== null &&
      officeTaps.length === 2 &&
      officeTaps.every((row) => (row.detail as { source: string }).source === 'office') &&
      deadLink.expiresAt.getTime() - Date.now() < 20 * 60 * 1000,
    `UR-015: the last stop completed the route at ${finished.completedAt?.toISOString()}; the office's two taps are logged as "office" rather than as the driver, and the link now dies in ${Math.round((deadLink.expiresAt.getTime() - Date.now()) / 60000)} minutes`);

  // --------------------------------------- S3 method switch and the map reroute
  const neighbourEmail = `reroute-${Date.now()}@example.test`;
  const { orderId: shipOrderId } = await sellAtCounter(manager, neighbourEmail, 'Reroute Donor', [
    // Same street address as the first stop, a different family: the offline
    // geocoder puts them in the same place, so the van is provably passing.
    { slug: CLASSIC, methodId: shipId, recipientName: 'Dov Neighbour', ...addressOf(HOUSES[0]) },
    { slug: CLASSIC, methodId: shipId, recipientName: 'Sara Elsewhere', line1: '410 Ocean Avenue', city: 'Lakewood', state: 'NJ', postalCode: '08701' },
  ]);

  const shipBoxes = await db.package.findMany({
    where: { orderId: shipOrderId },
    orderBy: { recipientName: 'asc' },
  });
  const neighbourBox = shipBoxes.find((box) => box.recipientName === 'Dov Neighbour')!;
  const elsewhereBox = shipBoxes.find((box) => box.recipientName === 'Sara Elsewhere')!;
  const feeBefore = neighbourBox.fulfillmentFeeCents;

  const neighbourPath = `${BOARD}/${neighbourBox.id}`;
  await manager.submit(
    formWith((await manager.get(neighbourPath)).body, neighbourPath, 'data-testid="buy-label"'),
  );

  // A second van, so there is a live route for the suggestion to land on.
  const secondDonorEmail = `van2-${Date.now()}@example.test`;
  const { orderId: van2OrderId } = await sellAtCounter(manager, secondDonorEmail, 'Van Two Donor', [
    { slug: CLASSIC, methodId: deliverId, ...HOUSES[0], recipientName: 'Malka Stop' },
  ]);
  const van2Boxes = await db.package.findMany({ where: { orderId: van2OrderId } });

  const secondRouteLocation = redirectOf(
    await manager.submit(
      formWith((await manager.get(ROUTES)).body, ROUTES, 'data-testid="build-route"'),
      {
        intent: 'build',
        label: `Reroute van ${Date.now()}`,
        deliveryDay: DELIVERY_DAY,
        packageIds: van2Boxes.map((box) => box.id),
      },
    ),
    'building the reroute van',
  );

  const secondPath = new URL(secondRouteLocation, BASE_URL).pathname;
  const secondRouteId = secondPath.split('/').pop() ?? '';
  const secondPage = await manager.get(secondPath);

  const suggestionForm = parseForms(secondPage.body, secondPath).find(
    (candidate) => candidate.fields.packageId === neighbourBox.id,
  );
  if (!suggestionForm) throw new Error('The neighbouring shipping box was not suggested for the van');

  const unconfirmed = flashValue(await manager.submit(suggestionForm), 'problem', true);
  const stopsAfterRefusal = await db.routeStop.count({ where: { routeId: secondRouteId } });

  expect('S3a', 'A suggested reroute does nothing until a manager confirms it',
    unconfirmed.includes('confirmation') && stopsAfterRefusal === 1,
    `G-027: the van passes ${HOUSES[0].line1} and the screen offers ${neighbourBox.recipientName}, but posting without the tick answers "${unconfirmed}" and the van still has ${stopsAfterRefusal} stop`);

  const confirmed = flashValue(await manager.submit(suggestionForm, { confirmed: 'on' }), 'notice');
  const moved = await db.package.findUniqueOrThrow({
    where: { id: neighbourBox.id },
    include: { fulfillmentMethod: true, routeStop: true },
  });
  const voidedParcel = await db.shipmentBox.findFirstOrThrow({ where: { packageId: neighbourBox.id } });
  const rerouteAudit = await db.auditEvent.findFirstOrThrow({
    where: { action: 'package.rerouted', entityId: neighbourBox.id },
  });

  expect('S3b', 'A confirmed reroute cancels the carrier label, joins the van, and leaves the charge alone',
    moved.fulfillmentMethod.kind === 'DELIVERY' &&
      moved.routeStop?.routeId === secondRouteId &&
      moved.fulfillmentFeeCents === feeBefore &&
      voidedParcel.status === 'VOIDED' &&
      (rerouteAudit.detail as { labelVoided: boolean }).labelVoided,
    `UR-002, G-005, G-028: "${confirmed}" — the ${voidedParcel.carrier} label is cancelled through the P8 void hook, the box is stop ${(moved.routeStop?.sequence ?? 0) + 1} on the van, and the customer still pays the ${(feeBefore / 100).toFixed(2)} they agreed to`);

  const elsewherePath = `${BOARD}/${elsewhereBox.id}`;
  await manager.submit(
    formWith((await manager.get(elsewherePath)).body, elsewherePath, 'data-testid="advance-stage"'),
    { stage: 'PRINTED' },
  );
  await manager.submit(
    formWith((await manager.get(elsewherePath)).body, elsewherePath, 'data-testid="advance-stage"'),
    { stage: 'PACKED' },
  );
  await manager.submit(
    formWith((await manager.get(elsewherePath)).body, elsewherePath, 'data-testid="advance-stage"'),
    { stage: 'SENT' },
  );

  const sentPage = await manager.get(elsewherePath);
  const sentBox = await db.package.findUniqueOrThrow({ where: { id: elsewhereBox.id } });

  expect('S3c', 'A box that has already gone out is not offered a change of method at all',
    sentBox.stage === 'SENT' && !sentPage.body.includes('data-testid="method-switch"'),
    `the switch form is not rendered for a Sent box, so the only way to move it is to get it back first — the service refuses it too (covered by the unit suite)`);

  // ------------------------------------------------------- S5 the pickup counter
  const collectorEmail = `pickup-${Date.now()}@example.test`;
  const { orderId: pickupOrderId } = await sellAtCounter(manager, collectorEmail, 'Pickup Collector', [
    { slug: CLASSIC, methodId: pickupId, recipientName: 'Shelf Family', pickupLocationId: pickupLocation.id },
  ]);

  const pickupBox = await db.package.findFirstOrThrow({ where: { orderId: pickupOrderId } });
  const counterBefore = await manager.get(PICKUP);

  expect('S5a', 'A box nobody has packed yet cannot be announced, and the counter says why',
    rowOf(counterBefore.body, pickupBox.id).includes('data-ready="false"') &&
      rowOf(counterBefore.body, pickupBox.id).includes('not packed yet') &&
      rowOf(counterBefore.body, pickupBox.id).includes('disabled'),
    `G-017: the row for ${pickupBox.recipientName} reads "not packed yet" and the Tell-them button is disabled, so nobody is asked to drive over for a box that is not made up`);

  const pickupPath = `${BOARD}/${pickupBox.id}`;
  for (const stage of ['PRINTED', 'PACKED']) {
    await manager.submit(
      formWith((await manager.get(pickupPath)).body, pickupPath, 'data-testid="advance-stage"'),
      { stage },
    );
  }

  const readyPage = await manager.get(PICKUP);
  const notifyForm = parseForms(readyPage.body, PICKUP).find(
    (candidate) => candidate.fields.packageId === pickupBox.id && candidate.html.includes('notify-ready'),
  );
  if (!notifyForm) throw new Error('No pickup-ready form for the packed box');

  const told = flashValue(await manager.submit(notifyForm), 'notice');
  const toldTwice = flashValue(await manager.submit(notifyForm), 'notice');
  const readyBox = await db.package.findUniqueOrThrow({ where: { id: pickupBox.id } });
  const notices = await db.notificationLog.count({
    where: { packageId: pickupBox.id, kind: 'pickup.ready' },
  });

  expect('S5b', 'A packed box in stock is announced exactly once, with a deadline on the shelf',
    notices === 1 &&
      told.includes('1 sent') &&
      toldTwice.includes('0 sent') &&
      readyBox.pickupReadyAt !== null &&
      readyBox.pickupExpiresAt !== null,
    `G-026: "${told}" then "${toldTwice}" — one notice on file, holding until ${readyBox.pickupExpiresAt?.toDateString()}`);

  const doorList = await manager.request('/admin/pickup/door-list');
  const doorBytes = Buffer.from(await doorList.arrayBuffer());

  const stampForm = parseForms((await manager.get(PICKUP)).body, PICKUP).find(
    (candidate) => candidate.fields.packageId === pickupBox.id && candidate.html.includes('stamp-collected'),
  );
  if (!stampForm) throw new Error('No collected form for the packed box');

  const collected = flashValue(await manager.submit(stampForm), 'notice');
  const home = await db.package.findUniqueOrThrow({ where: { id: pickupBox.id } });

  expect('S5c', 'The door list prints the waiting boxes, and collecting one stamps it',
    doorList.status === 200 &&
      doorBytes.subarray(0, 4).toString() === '%PDF' &&
      doorBytes.includes(Buffer.from(pickupBox.recipientName)) &&
      home.stage === 'PICKED_UP' &&
      home.pickedUpAt !== null,
    `UR-010: a ${doorBytes.length}-byte door list with ${pickupBox.recipientName} and a tick box on it, and "${collected}" stamped the box at ${home.pickedUpAt?.toISOString()}`);

  // A box somebody was told about a week ago and never came for, so the sweep
  // below has something real to find rather than an empty table.
  const strandedEmail = `stranded-${Date.now()}@example.test`;
  const { orderId: strandedOrderId } = await sellAtCounter(manager, strandedEmail, 'Stranded Collector', [
    { slug: CLASSIC, methodId: pickupId, recipientName: 'Shelf Two', pickupLocationId: pickupLocation.id },
  ]);

  const strandedBox = await db.package.findFirstOrThrow({ where: { orderId: strandedOrderId } });
  const strandedPath = `${BOARD}/${strandedBox.id}`;
  for (const stage of ['PRINTED', 'PACKED']) {
    await manager.submit(
      formWith((await manager.get(strandedPath)).body, strandedPath, 'data-testid="advance-stage"'),
      { stage },
    );
  }

  const strandedNotify = parseForms((await manager.get(PICKUP)).body, PICKUP).find(
    (candidate) => candidate.fields.packageId === strandedBox.id && candidate.html.includes('notify-ready'),
  );
  if (!strandedNotify) throw new Error('No pickup-ready form for the second packed box');
  await manager.submit(strandedNotify);

  // The only thing the clock is asked to fake: the deadline is moved into
  // yesterday so the sweep runs against a genuinely overdue shelf.
  await db.package.update({
    where: { id: strandedBox.id },
    data: { pickupExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  });

  // ----------------------------------------------------- S5 the scheduled jobs
  const secret = process.env.CRON_SECRET ?? '';
  const bare = await fetch(new URL('/api/cron/pickup-expiry', BASE_URL), { method: 'POST' });
  const wrong = await fetch(new URL('/api/cron/pickup-expiry', BASE_URL), {
    method: 'POST',
    headers: { authorization: 'Bearer not-the-secret' },
  });
  const authorized = await fetch(new URL('/api/cron/pickup-expiry', BASE_URL), {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  });
  const sweepBody = (await authorized.json()) as { job: string; expired: number };

  const reminder = await fetch(new URL('/api/cron/payment-reminder', BASE_URL), {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  });
  const reminderBody = (await reminder.json()) as { job: string; orders: number; queued: number };

  const runs = await db.cronRunLog.findMany({
    where: { jobName: { in: ['pickup.expiry-sweep', 'payment.reminder-sweep'] } },
    orderBy: { startedAt: 'desc' },
    take: 2,
  });

  const sweptBox = await db.package.findUniqueOrThrow({ where: { id: strandedBox.id } });

  expect('S5d', 'Both cron endpoints refuse anybody without the shared secret and log every run they do',
    bare.status === 401 &&
      wrong.status === 401 &&
      authorized.status === 200 &&
      reminder.status === 200 &&
      sweepBody.expired >= 1 &&
      sweptBox.pickupExpiredAt !== null &&
      runs.length === 2 &&
      runs.every((entry) => entry.status === 'SUCCEEDED'),
    `R-182, R-080: no header → ${bare.status}, wrong secret → ${wrong.status}, right secret → ${authorized.status} (${sweepBody.job}: ${sweepBody.expired} expired, including ${sweptBox.recipientName}) and ${reminder.status} (${reminderBody.job}: ${reminderBody.orders} orders, ${reminderBody.queued} reminders sent); both wrote a CronRunLog row`);

  // ------------------------------------------ S4 bulk scheduling and follow-up
  const bulkEmail = `bulk-${Date.now()}@example.test`;
  const { orderId: bulkOrderId } = await sellAtCounter(manager, bulkEmail, 'Bulk Donor', [
    { slug: CLASSIC, methodId: deliverId, recipientName: 'Bulk One', ...addressOf(HOUSES[1]) },
    { slug: CLASSIC, methodId: deliverId, recipientName: 'Bulk Two', ...addressOf(HOUSES[2]) },
  ]);

  const bulkBoxes = await db.package.findMany({ where: { orderId: bulkOrderId } });
  const bulkPage = await manager.get(ROUTES);
  const bulkForm = formWith(bulkPage.body, ROUTES, 'data-testid="schedule-bulk"');

  const scheduled = flashValue(
    await manager.submit(bulkForm, {
      intent: 'schedule',
      packageIds: bulkBoxes.map((box) => box.id),
      bulkDeliveryDay: DELIVERY_DAY,
      deliveryWindow: '10am and 2pm',
    }),
    'notice',
  );

  const bulkCustomer = await db.customer.findUniqueOrThrow({ where: { normalizedEmail: bulkEmail } });
  const bulkNotices = await db.notificationLog.findMany({
    where: { customerId: bulkCustomer.id, kind: 'delivery.bulk_scheduled' },
  });
  const windowed = await db.package.findMany({ where: { id: { in: bulkBoxes.map((box) => box.id) } } });

  expect('S4b', 'Scheduling a stack of boxes writes one message per customer, not one per box',
    bulkBoxes.length === 2 &&
      bulkNotices.length === 1 &&
      bulkNotices[0].channel === 'EMAIL' &&
      windowed.every((box) => box.deliveryWindow === '10am and 2pm'),
    `G-021: "${scheduled}" — 2 boxes, 1 donor, ${bulkNotices.length} message; the SMS row is skipped because there is no mobile on file, and both boxes carry the window`);

  const anyReason = await manager.get('/admin/follow-up');
  const unclaimedOnly = await manager.get('/admin/follow-up?reason=pickup_unclaimed');
  const unpaidOnly = await manager.get('/admin/follow-up?reason=unpaid');

  const strandedOrder = await db.order.findUniqueOrThrow({ where: { id: strandedOrderId } });

  expect('S4c', 'The box nobody came for turns into a phone call, and the list filters by which call it is',
    anyReason.body.includes(`data-order-id="${strandedOrder.id}"`) &&
      unclaimedOnly.body.includes(`data-order-id="${strandedOrder.id}"`) &&
      countOf(unclaimedOnly.body, 'data-reason="pickup_unclaimed"') ===
        countOf(unclaimedOnly.body, 'data-testid="follow-up-row"') &&
      !unpaidOnly.body.includes(`data-order-id="${strandedOrder.id}"`),
    `R-079: ${strandedBox.recipientName}'s order is on the list as a box waiting at the counter (${countOf(unclaimedOnly.body, 'data-testid="follow-up-row"')} of ${countOf(anyReason.body, 'data-testid="follow-up-row"')} rows), every row on that filter is the same reason, and the money filter does not show it because the order is paid`);

  // ------------------------------------------------------------ permissions
  const driver = new Session(BASE_URL);
  await signInStaff(driver, DRIVER_EMAIL);
  const driverRoutes = await driver.get(ROUTES);
  const driverHome = await driver.get('/driver');

  expect('S1f', 'Planning routes is the office\u2019s, driving them is not',
    driverRoutes.status === 403 && driverHome.status === 200,
    `${DRIVER_EMAIL} is refused ${ROUTES} (${driverRoutes.status}) and sees only their own assigned vans on /driver — a volunteer never gets the planning screen`);

  // ----------------------------------------------------- unit test citations
  const testRun = runTests(TEST_FILES, TEST_DATABASE_URL);
  const passedTests = new Set(testRun.passed);

  expectTest('P9-1', 'Route building, ordering and completion are covered by unit tests', passedTests, [
    'stops come back nearest-first from the shipping room, and unplaced ones go last',
    'building a route places every stop, and the day-of notice goes once per box',
    'the last stop closes the route, sends the box, and kills the link',
  ]);

  expectTest('P9-2', 'The driver link and the reroute rules are covered by unit tests', passedTests, [
    'a driver link is unguessable, throttled, and dead the moment it is revoked',
    'switching a box onto a van cancels its label and never re-prices the customer',
    'a reroute onto a van needs somebody to confirm it, and then joins the route',
    'a driver is sent to the right house by a link the phone already knows how to open',
  ]);

  expectTest('P9-3', 'Pickup, scheduling and the cron gate are covered by unit tests', passedTests, [
    'a pickup box is only announced when the food is on the shelf, and holds for a week',
    'bulk scheduling writes one message per customer, not one per box',
    'the payment reminder job chases overdue orders once and logs its run',
    'a cron endpoint answers nothing without the shared secret',
  ]);

  record('P9-4', 'The P9 test file is green', testRun.failed.length === 0,
    `${testRun.passed.length} tests passed, ${testRun.failed.length} failed`);

  const ci = runCommand('npm', ['run', 'ci'], envWithoutDatabaseUrl());
  record('P9-5', 'Lint, typecheck, migration guard and the whole suite pass', ci.status === 0,
    ci.status === 0 ? 'npm run ci exited 0' : ci.output.trim().split('\n').slice(-6).join(' / '));

  run.write();
}

/** The value a server action put on the redirect, as staff would read it. */
function flashValue(source: Response | string, name = 'notice', allowMissing = false): string {
  const location =
    typeof source === 'string' ? source : (source.headers.get('location') ?? '');

  if (typeof source !== 'string' && source.status !== 303 && !allowMissing) {
    throw new Error(`Expected a redirect, got ${source.status}`);
  }

  const found = new RegExp(`[?&]${name}=([^&]*)`).exec(location)?.[1] ?? '';
  return decodeURIComponent(found.replaceAll('+', ' '));
}

async function firstDeliveryDay(): Promise<string> {
  const row = await db.setting.findUnique({ where: { key: 'delivery.dayChoices' } });
  const days = Array.isArray(row?.value) ? (row.value as string[]) : [];

  if (days.length === 0) throw new Error('The season has no delivery days configured.');
  return days[0];
}

function countOf(html: string, marker: string): number {
  return html.split(marker).length - 1;
}

/** The one table row for a package, so a check reads that row and not the page. */
function rowOf(html: string, packageId: string): string {
  const start = html.indexOf(`data-package-id="${packageId}"`);
  if (start === -1) return '';

  const from = html.lastIndexOf('<tr', start);
  const to = html.indexOf('</tr>', start);
  return html.slice(from === -1 ? start : from, to === -1 ? undefined : to);
}

function addressOf(house: (typeof HOUSES)[number]) {
  return { line1: house.line1, city: house.city, state: house.state, postalCode: house.postalCode };
}

type CounterLine = {
  slug: string;
  methodId: string;
  recipientName: string;
  line1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  pickupLocationId?: string;
};

/** Sells a counter order and places it, which is how every box in this run exists. */
async function sellAtCounter(
  session: Session,
  email: string,
  fullName: string,
  lines: CounterLine[],
): Promise<{ orderId: string }> {
  const builderPath = await openTill(session, email, fullName);

  for (const line of lines) {
    await addAtCounter(session, builderPath, line.slug);
  }

  const cart = counterLines((await session.get(builderPath)).body);

  for (const [index, line] of lines.entries()) {
    await assign(session, builderPath, cart[index].id, {
      target: 'new',
      recipientName: line.recipientName,
      fulfillmentMethodId: line.methodId,
      pickupLocationId: line.pickupLocationId ?? '',
      line1: line.line1 ?? '',
      line2: '',
      city: line.city ?? '',
      state: line.state ?? '',
      postalCode: line.postalCode ?? '',
      phone: '',
      label: '',
      greetingMessage: '',
    });
  }

  const checkoutPath = `${builderPath}/checkout`;
  await chooseDeliveryDays(session, checkoutPath);

  const checkout = await session.get(checkoutPath);
  const sold = await session.submit(formWith(checkout.body, checkoutPath, 'data-testid="pos-sell"'), {
    method: 'CASH',
    reference: 'Drawer 1',
  });

  const landing = redirectOf(sold, `ringing up ${email}`);
  if (!landing.startsWith('/admin/orders/')) {
    throw new Error(`The counter refused the sale for ${email}: ${landing}`);
  }

  const customer = await db.customer.findUniqueOrThrow({ where: { normalizedEmail: email } });
  const order = await db.order.findFirstOrThrow({
    where: { customerId: customer.id, status: 'PLACED' },
  });

  return { orderId: order.id };
}

/**
 * Delivery boxes cannot be rung up until somebody has said which day they go
 * out (R-035), so the counter picks the season's first day for every one of
 * them — the same day the route builder then filters candidates by.
 */
async function chooseDeliveryDays(session: Session, checkoutPath: string): Promise<void> {
  const answered = new Set<string>();

  for (;;) {
    const page = await session.get(checkoutPath);
    const form = parseForms(page.body, checkoutPath).find(
      (candidate) =>
        candidate.html.includes('data-testid="delivery-day-submit"') &&
        !answered.has(candidate.fields.recipientKey ?? ''),
    );
    if (!form) return;

    answered.add(form.fields.recipientKey ?? '');
    await session.submit(form, { deliveryDay: DELIVERY_DAY });
  }
}

function counterLines(html: string): { id: string }[] {
  return html
    .slice(html.indexOf('data-testid="pos-cart"'))
    .split('data-testid="cart-line"')
    .slice(1)
    .map((chunk) => ({ id: /data-line-id="([^"]*)"/.exec(chunk)?.[1] ?? '' }));
}

async function openTill(session: Session, email: string, fullName: string): Promise<string> {
  const page = await session.get('/admin/pos');
  const form = formWith(page.body, '/admin/pos', 'data-testid="pos-find-customer"');

  const location = redirectOf(
    await session.submit(form, { fullName, email, phone: '' }),
    'opening the till',
  );

  return new URL(location, BASE_URL).pathname;
}

async function addAtCounter(session: Session, builderPath: string, slug: string): Promise<void> {
  const page = await session.get(builderPath);
  const form = parseForms(page.body, builderPath).find((candidate) => candidate.fields.slug === slug);
  if (!form) throw new Error(`No add form for ${slug} on the counter builder`);

  redirectOf(await session.submit(form, { quantity: '1', 'option:Size': 'Standard' }), `adding ${slug}`);
}

async function assign(
  session: Session,
  builderPath: string,
  lineId: string,
  values: Record<string, string>,
): Promise<void> {
  const path = `${builderPath}?assign=${lineId}&add=1`;
  const page = await session.get(path);
  const form = formWith(page.body, path, 'data-testid="add-recipient-submit"');

  redirectOf(await session.submit(form, { lineId, ...values }), `assigning ${lineId}`);
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
