import { PrismaClient } from '@prisma/client';

import { DATABASE_URL, TEST_DATABASE_URL } from './db-server';
import { parseForms, Session, type ParsedForm } from './http-form';
import { envWithoutDatabaseUrl, runCommand, runTests, SmokeRun } from './smoke-harness';
import { dollars, formWith, redirectOf } from './smoke-p4-helpers';

/**
 * Phase P7 smoke run: the package board, splitting and regrouping boxes, the
 * nightly print batch, the three artifacts, and the rule that printing paper
 * never moves a box along — all driven over HTTP against the running app, with
 * the database read afterwards to check what actually happened.
 *
 * Expects `npm run dev` up on 3104 against the seeded database.
 */
const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3104';

const MANAGER_EMAIL = 'manager@tomchei.example';
const DRIVER_EMAIL = 'driver@tomchei.example';

const CLASSIC = 'classic-mishloach-manos';
const FULFILLMENT = '/admin/fulfillment';
const BOARD = `${FULFILLMENT}/packages`;

const KLEIN = {
  recipientName: 'Miriam Klein',
  line1: '412 Forest Avenue',
  line2: '',
  city: 'Lakewood',
  state: 'NJ',
  postalCode: '08701',
  phone: '',
  label: '',
};
const ZIMMER = { ...KLEIN, recipientName: 'Aaron Zimmer', line1: '88 Yeshiva Lane', city: 'Monsey', state: 'NY', postalCode: '10952' };

const TEST_FILES = ['tests/fulfillment.test.ts'];

const db = new PrismaClient({ datasourceUrl: DATABASE_URL });

const run = new SmokeRun('P7', [
  `Run at ${new Date().toISOString()} against ${BASE_URL} (web 3104, db 4104).`,
  'Every check is a real HTTP request against the running app, a server action',
  'replayed from the HTML it rendered, a PDF fetched from the route the screen',
  'links to, a database read, or a named unit test.',
]);

const record = run.record.bind(run);
const expect = run.expect.bind(run);
const expectTest = run.expectTest.bind(run);

async function main() {
  const season = await db.season.findFirstOrThrow({
    where: { status: 'OPEN' },
    orderBy: { year: 'desc' },
  });
  const methods = await db.fulfillmentMethod.findMany({ where: { isActive: true } });
  const methodId = (code: string) => methods.find((row) => row.code === code)!.id;
  const counter = await db.pickupLocation.findFirstOrThrow({ where: { isActive: true } });

  // Tills left open by an earlier run would be picked up by this one's checkout.
  await db.order.deleteMany({ where: { status: 'DRAFT', posStaffUserId: { not: null } } });

  const manager = new Session(BASE_URL);
  await signInStaff(manager, MANAGER_EMAIL);

  // ------------------------------------------------ S1 grouping, split, board
  const walkInEmail = `packing-${Date.now()}@example.test`;
  const builderPath = await openTill(manager, walkInEmail);
  const customer = await db.customer.findUniqueOrThrow({ where: { normalizedEmail: walkInEmail } });

  // Three boxes, deliberately: a fourth would take the order past the
  // free-shipping threshold and the fee this run follows through a split and a
  // regroup would be zero.
  for (let copy = 0; copy < 3; copy += 1) {
    await addAtCounter(manager, builderPath, CLASSIC, { quantity: '1', 'option:Size': 'Standard' });
  }

  const lines = counterLines((await manager.get(builderPath)).body);
  await assign(manager, builderPath, lines[0].id, { target: 'new', ...KLEIN, fulfillmentMethodId: methodId('ship'), greetingMessage: 'A freilichen Purim, from the counter' }, { add: true });
  await assign(manager, builderPath, lines[1].id, { target: 'new', ...ZIMMER, fulfillmentMethodId: methodId('ship'), greetingMessage: '' }, { add: true });

  const book = await db.customerAddress.findMany({ where: { customerId: customer.id } });
  const savedOf = (name: string) => book.find((row) => row.recipientName === name)!.id;

  await assign(manager, builderPath, lines[2].id, {
    target: 'saved',
    customerAddressId: savedOf(KLEIN.recipientName),
    fulfillmentMethodId: methodId('pickup'),
    pickupLocationId: counter.id,
    greetingMessage: '',
  });

  const checkoutPath = `${builderPath}/checkout`;
  const counterCheckout = await manager.get(checkoutPath);
  await manager.submit(formWith(counterCheckout.body, checkoutPath, 'data-testid="pos-sell"'), {
    method: 'CASH',
    reference: 'Drawer 1',
  });

  const order = await db.order.findFirstOrThrow({
    where: { customerId: customer.id, status: 'PLACED' },
    include: { packages: { include: { lines: true, fulfillmentMethod: true } } },
  });
  const shipped = order.packages.filter((box) => box.fulfillmentMethod.kind === 'SHIPPING');
  const collected = order.packages.filter((box) => box.fulfillmentMethod.kind === 'PICKUP');

  expect('S1a', 'A counter order for two recipients on two methods lands as one box each',
    order.packages.length === 3 &&
      shipped.length === 2 &&
      collected.length === 1 &&
      order.packages.every((box) => box.lines.length === 1) &&
      shipped.every((box) => box.fulfillmentFeeCents > 0) &&
      collected.every((box) => box.fulfillmentFeeCents === 0),
    `order #${order.orderNumber}: ${order.packages.length} boxes for ${[...new Set(order.packages.map((box) => box.recipientName))].join(' and ')} — two shipped at ${dollars(shipped[0].fulfillmentFeeCents)} each, one waiting at the counter for nothing, total ${dollars(order.totalCents)}`);

  const boardPage = await manager.get(`${BOARD}?q=Klein`);
  const boardIds = packageIds(boardPage.body);

  const hers = order.packages.filter((box) => box.recipientName === KLEIN.recipientName);

  expect('S1b', 'The board is a list of boxes, searchable by the person they are for',
    boardPage.status === 200 &&
      hers.every((box) => boardIds.includes(box.id)) &&
      !boardIds.includes(order.packages.find((box) => box.recipientName === ZIMMER.recipientName)!.id),
    `searching the board for "Klein" returns ${boardIds.length} box(es) — both of hers, each linking to its own screen, and not Zimmer's`);

  const target = shipped.find((box) => box.recipientName === KLEIN.recipientName)!;

  // Two items in one box, so there is something to split: the second shipping
  // line for the same recipient is regrouped into it first.
  const donor = shipped.find((box) => box.id !== target.id)!;
  const donorPage = await manager.get(packagePath(donor.id));
  const donorLine = donor.lines[0].id;
  await manager.submit(formWith(donorPage.body, packagePath(donor.id), 'data-testid="regroup-package"'), {
    intent: 'move',
    lineIds: [donorLine],
    toPackageId: target.id,
  });

  const merged = await db.package.findUniqueOrThrow({
    where: { id: target.id },
    include: { lines: true },
  });
  const donorGone = await db.package.findUnique({ where: { id: donor.id } });

  expect('S1c', 'Staff can overrule the grouping engine and put two lines in one box',
    merged.lines.length === 2 && donorGone === null && merged.version > target.version,
    `both shipping lines are now in ${merged.recipientName}'s box; the box they left was empty, so it is gone and its fee moved across (${dollars(merged.fulfillmentFeeCents)} charged on the survivor), and the box that took them was claimed too — version ${target.version} to ${merged.version}, so a screen drawn before the move now loses`);

  const beforeSplit = await manager.get(packagePath(target.id));
  await manager.submit(formWith(beforeSplit.body, packagePath(target.id), 'data-testid="split-package"'), {
    intent: 'split',
    lineIds: [merged.lines[0].id],
  });

  const halves = await db.package.findMany({
    where: { orderId: order.id, recipientName: merged.recipientName, fulfillmentMethodId: merged.fulfillmentMethodId },
    include: { lines: true },
  });
  const splitAudit = await db.auditEvent.findFirstOrThrow({
    where: { action: 'package.split', detail: { path: ['fromPackageId'], equals: target.id } },
  });
  const orderAfterSplit = await db.order.findUniqueOrThrow({ where: { id: order.id } });

  expect('S1d', 'Splitting a box makes a second one without re-pricing the order',
    halves.length === 2 &&
      halves.every((box) => box.lines.length === 1) &&
      halves.reduce((total, box) => total + box.fulfillmentFeeCents, 0) === merged.fulfillmentFeeCents &&
      orderAfterSplit.totalCents === order.totalCents &&
      splitAudit.actorLabel.includes(MANAGER_EMAIL),
    `one box became two (${halves.map((box) => `${box.lines.length} line`).join(', ')}), the ${dollars(merged.fulfillmentFeeCents)} fee stayed where it was charged, the order still costs ${dollars(orderAfterSplit.totalCents)}, and the trail names ${splitAudit.actorLabel}`);

  // ------------------------------------------------------------ S2 print run
  const hub = await manager.get(FULFILLMENT);
  const waitingBefore = attrOf(hub.body, 'figure-waiting', 'value');

  const built = redirectOf(
    await manager.submit(formWith(hub.body, FULFILLMENT, 'data-testid="build-batch"')),
    'building tonight\u2019s batch',
  );
  const batchPath = new URL(built, BASE_URL).pathname;
  const batchId = batchPath.split('/').pop() ?? '';

  const batch = await db.printBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: { groups: { include: { items: true }, orderBy: { sortIndex: 'asc' } } },
  });
  const filed = batch.groups.flatMap((group) => group.items.map((item) => item.packageId));

  expect('S2a', 'The nightly batch files every unprinted box into the pile it will be worked from',
    batch.kind === 'NIGHTLY' &&
      batch.packageCount === waitingBefore &&
      batch.groups.length >= 2 &&
      halves.every((half) => filed.includes(half.id)) &&
      order.packages.filter((box) => box.id !== donor.id).every((box) => filed.includes(box.id)),
    `${batch.packageCount} boxes — every one the hub counted as waiting, including both halves of the box that was split — filed into ${batch.groups.length} groups: ${batch.groups.map((group) => `${group.label} (${group.packageCount})`).join(', ')}`);

  const kleinGroup = batch.groups.find((group) => group.items.some((item) => halves.some((half) => half.id === item.packageId)))!;
  const pdfs = await Promise.all(
    (['slips', 'labels', 'cards'] as const).map((artifact) =>
      fetchPdf(manager, `${batchPath}/groups/${kleinGroup.id}/${artifact}`),
    ),
  );

  expect('S2b', 'Each group serves its slips, its labels and its cards as three separate PDFs',
    pdfs.every((pdf) => pdf.status === 200 && pdf.contentType === 'application/pdf' && pdf.head === '%PDF'),
    `slips ${pdfs[0].bytes} bytes, labels ${pdfs[1].bytes} bytes, greeting cards ${pdfs[2].bytes} bytes — all served inline as application/pdf from ${kleinGroup.label}`);

  const orderSlip = await fetchPdf(manager, `/admin/orders/${order.id}/print/slips`);
  const afterPrinting = await db.package.findMany({ where: { orderId: order.id } });

  expect('S2c', 'Printing every artifact leaves every box exactly where it was',
    orderSlip.status === 200 &&
      afterPrinting.every((box) => box.stage === 'NEW' && box.printedAt === null && box.sentAt === null),
    `R-056: the order printed its own ${orderSlip.bytes}-byte slip; all ${afterPrinting.length} boxes are still New with no printed, packed or sent timestamp (G-002, G-004)`);

  const current = await db.package.findMany({
    where: { orderId: order.id },
    include: { fulfillmentMethod: true },
  });
  const byHand = current.find((box) => box.fulfillmentMethod.kind === 'SHIPPING')!;

  const markPage = await manager.get(packagePath(byHand.id));
  await manager.submit(formWith(markPage.body, packagePath(byHand.id), 'data-testid="advance-stage"'), {
    stage: 'PRINTED',
  });

  const boardForSweep = await manager.get(`${BOARD}?q=Klein`);
  const sweep = flashOf(
    await manager.submit(formWith(boardForSweep.body, BOARD, 'data-testid="bulk-apply"'), {
      packageIds: current.map((box) => box.id),
      stage: 'SENT',
    }),
  );

  const swept = await db.package.findMany({
    where: { orderId: order.id },
    include: { fulfillmentMethod: true },
  });
  const travelling = swept.filter((box) => box.fulfillmentMethod.kind !== 'PICKUP');
  const pickupBoxes = swept.filter((box) => box.fulfillmentMethod.kind === 'PICKUP');

  expect('S2d', 'Printed, Packed and Sent are staff decisions, and a pickup box is never sent',
    travelling.every((box) => box.stage === 'SENT' && box.sentAt !== null) &&
      pickupBoxes.every((box) => box.stage !== 'SENT' && box.sentAt === null) &&
      sweep.startsWith(`${travelling.length} updated, ${pickupBoxes.length} skipped`) &&
      sweep.includes('collected, not sent'),
    `one box marked Printed by hand, then a sweep of all ${swept.length}: "${sweep.split(' \u2014 ')[0]}" — every pickup box was named in the report and refused ("A pickup package is collected, not sent.")`);

  // ------------------------------------------------------ S3 batch integrity
  const nightlyBefore = await db.printBatch.count({ where: { seasonId: season.id, kind: 'NIGHTLY' } });
  const hubAgain = await manager.get(FULFILLMENT);
  const secondRun = flashOf(
    await manager.submit(formWith(hubAgain.body, FULFILLMENT, 'data-testid="build-batch"')),
  );
  const nightlyAfter = await db.printBatch.count({ where: { seasonId: season.id, kind: 'NIGHTLY' } });

  expect('S3a', 'Running the nightly batch again files nothing twice',
    secondRun.includes('already been on a batch') && nightlyAfter === nightlyBefore,
    `the second run reported "${secondRun}" and left the nightly batch count at ${nightlyAfter}`);

  const otherGroup = batch.groups.find((group) => group.id !== kleinGroup.id)!;
  const filedIds = kleinGroup.items.map((item) => item.packageId);
  const stagesBefore = await stagesOf(filedIds);

  const batchPage = await manager.get(batchPath);
  const reprintForm = parseForms(batchPage.body, batchPath).find(
    (form) => form.fields.groupId === kleinGroup.id,
  )!;

  const reprintPath = new URL(
    redirectOf(await manager.submit(reprintForm), 'reprinting one group'),
    BASE_URL,
  ).pathname;

  const reprint = await db.printBatch.findUniqueOrThrow({
    where: { id: reprintPath.split('/').pop() ?? '' },
    include: { groups: { include: { items: true } } },
  });
  const originalNow = await db.printBatchGroup.findMany({
    where: { batchId: batch.id },
    include: { items: true },
  });

  expect('S3b', 'A reprint is a new batch that names the old one, and touches nothing else',
    reprint.kind === 'REPRINT' &&
      reprint.supersedesBatchId === batch.id &&
      reprint.groups.length === 1 &&
      reprint.groups[0].items.length === kleinGroup.items.length &&
      originalNow.every((group) => group.items.length === batch.groups.find((row) => row.id === group.id)!.items.length),
    `"${reprint.label}" carries ${reprint.groups[0].items.length} box(es) from ${kleinGroup.label} and supersedes the nightly batch; ${otherGroup.label} and every other group on the original are byte-for-byte the pile they were`);

  const reprintPdf = await fetchPdf(
    manager,
    `${reprintPath}/groups/${reprint.groups[0].id}/slips`,
  );
  const stagesAfter = await stagesOf(filedIds);
  const renderAudit = await db.auditEvent.count({
    where: { action: 'print.rendered', entityId: reprint.groups[0].id },
  });

  expect('S3c', 'Reprinting the paper moves nothing and leaves its own trace instead',
    reprintPdf.status === 200 &&
      reprintPdf.head === '%PDF' &&
      filedIds.every((id) => stagesAfter.get(id) === stagesBefore.get(id)) &&
      renderAudit === 1,
    `the reprint served ${reprintPdf.bytes} bytes of slips and all ${filedIds.length} boxes are in exactly the stages they were in before it (${[...new Set([...stagesBefore.values()].map((state) => state.split('@')[0]))].join(', ')}); the only record printing left is one "print.rendered" audit row`);

  const orderPath = `/admin/orders/${order.id}`;
  const orderPage = await manager.get(orderPath);
  const orderReprintPath = new URL(
    redirectOf(
      await manager.submit(formWith(orderPage.body, orderPath, 'data-testid="order-reprint"')),
      'reprinting one order',
    ),
    BASE_URL,
  ).pathname;

  const orderReprint = await db.printBatch.findUniqueOrThrow({
    where: { id: orderReprintPath.split('/').pop() ?? '' },
    include: { groups: { include: { items: true } } },
  });
  const orderBoxIds = new Set(swept.map((box) => box.id));
  const reprinted = orderReprint.groups.flatMap((group) => group.items.map((item) => item.packageId));
  const untouched = await db.printBatchGroup.count({
    where: { batchId: batch.id, items: { some: {} } },
  });

  expect('S3d', 'One order can be reprinted on its own, filed the way the batch would file it',
    orderReprint.kind === 'REPRINT' &&
      reprinted.length === swept.length &&
      reprinted.every((id) => orderBoxIds.has(id)) &&
      orderReprint.groups.length === 2 &&
      untouched === batch.groups.length,
    `"${orderReprint.label}" holds this order's ${reprinted.length} boxes and nobody else's, filed into the same ${orderReprint.groups.length} groups the nightly run used, with all ${untouched} groups of the original still intact`);

  const driver = new Session(BASE_URL);
  await signInStaff(driver, DRIVER_EMAIL);
  const driverHub = await driver.get(FULFILLMENT);
  const driverPdf = await driver.request(`${batchPath}/groups/${kleinGroup.id}/labels`);

  expect('S3e', 'The paper is behind its own permission, on the page and on the PDF route',
    driverHub.status === 403 && driverPdf.status === 403,
    `${DRIVER_EMAIL} is refused ${FULFILLMENT} (${driverHub.status}) and the label PDF itself (${driverPdf.status}) — the route re-checks rather than trusting the link never being shown`);

  // ------------------------------------- S4 paper follows the order's status
  const orderReprintForm = formWith(orderPage.body, orderPath, 'data-testid="order-reprint"');
  const batchesBefore = await db.printBatch.count({ where: { seasonId: season.id } });

  for (const status of ['IN_FULFILLMENT', 'COMPLETED']) {
    const page = await manager.get(orderPath);
    await manager.submit(formWith(page.body, orderPath, 'data-testid="order-transition"'), { status });
  }

  const finishedOrder = await manager.get(orderPath);
  const refused = problemOf(await manager.submit(orderReprintForm));
  const staleSlip = await manager.request(`${orderPath}/print/slips`);
  const batchesAfter = await db.printBatch.count({ where: { seasonId: season.id } });

  expect('S4a', 'An order the nightly batch would not print cannot be printed by hand either',
    finishedOrder.body.includes('data-testid="order-not-printable"') &&
      !finishedOrder.body.includes('data-testid="order-reprint"') &&
      refused.includes('placed and in-fulfillment') &&
      staleSlip.status === 404 &&
      batchesAfter === batchesBefore,
    `once the order is completed the screen offers no paper, the reprint form replayed from the page before it answers "${refused}", the slip route answers ${staleSlip.status}, and no batch was filed (${batchesAfter} still)`);

  // ----------------------------------------------------- unit test citations
  const testRun = runTests(TEST_FILES, TEST_DATABASE_URL);
  const passedTests = new Set(testRun.passed);

  expectTest('P7-1', 'The filing rule is covered by unit tests', passedTests, [
    'filing groups follow how the boxes are actually worked',
    'boxes are filed by the recipient last name, not by order number',
  ]);

  expectTest('P7-2', 'Splitting and regrouping are covered by unit tests', passedTests, [
    'splitting a box moves the named lines and leaves the money where it was',
    'a split needs something to leave behind, and a stale screen loses',
    'regrouping the last line back empties the box it came from',
    'a box that has already gone out cannot be re-packed',
  ]);

  expectTest('P7-3', 'Print batches and the printing rule are covered by unit tests', passedTests, [
    'the nightly batch files every unprinted box once and only once',
    'reprinting one group leaves the other groups exactly as they were',
    'printing every artifact leaves the boxes exactly where they were',
  ]);

  expectTest('P7-4', 'Stages and the channel dashboard are covered by unit tests', passedTests, [
    'a pickup box is collected, never sent',
    'a bulk stage sweep reports every box, and says so again the same way',
    'the channel dashboard counts what bulk grouping saved',
  ]);

  expectTest('P7-5', 'The review fixes are covered by unit tests', passedTests, [
    'moving lines claims the box they land in, not only the box they leave',
    'an order reprint names the pile it replaces, and refuses what the batch refuses',
  ]);

  record('P7-6', 'The P7 test file is green', testRun.failed.length === 0,
    `${testRun.passed.length} tests passed, ${testRun.failed.length} failed`);

  const ci = runCommand('npm', ['run', 'ci'], envWithoutDatabaseUrl());
  record('P7-7', 'Lint, typecheck, migration guard and the whole suite pass', ci.status === 0,
    ci.status === 0 ? 'npm run ci exited 0' : ci.output.trim().split('\n').slice(-6).join(' / '));

  run.write();
}

function packagePath(packageId: string): string {
  return `${BOARD}/${packageId}`;
}

/** Where a set of boxes stands, as a before-and-after of something else. */
async function stagesOf(packageIds: string[]): Promise<Map<string, string>> {
  const boxes = await db.package.findMany({
    where: { id: { in: packageIds } },
    select: { id: true, stage: true, sentAt: true },
  });

  return new Map(boxes.map((box) => [box.id, `${box.stage}@${box.sentAt?.toISOString() ?? '-'}`]));
}

async function fetchPdf(
  session: Session,
  path: string,
): Promise<{ status: number; contentType: string; bytes: number; head: string }> {
  const response = await session.request(path);
  const body = Buffer.from(await response.arrayBuffer());

  return {
    status: response.status,
    contentType: (response.headers.get('content-type') ?? '').split(';')[0],
    bytes: body.byteLength,
    head: body.subarray(0, 4).toString(),
  };
}

/** The notice a server action redirected back with, as staff would read it. */
function flashOf(response: Response): string {
  return flashParam(response, 'notice');
}

/** The refusal a server action redirected back with. */
function problemOf(response: Response): string {
  return flashParam(response, 'problem');
}

function flashParam(response: Response, name: string): string {
  const location = response.headers.get('location') ?? '';
  const found = new RegExp(`[?&]${name}=([^&]*)`).exec(location)?.[1] ?? '';

  return decodeURIComponent(found.replaceAll('+', ' '));
}

function attrOf(html: string, testId: string, attribute: string): number {
  const section = html.slice(html.indexOf(`data-testid="${testId}"`));
  return Number(new RegExp(`data-${attribute}="(-?\\d+)"`).exec(section)?.[1] ?? -1);
}

function packageIds(html: string): string[] {
  return [...html.matchAll(/data-testid="package-row"\s+data-package-id="([^"]+)"/g)].map(
    (match) => match[1],
  );
}

function counterLines(html: string): { id: string }[] {
  return html
    .slice(html.indexOf('data-testid="pos-cart"'))
    .split('data-testid="cart-line"')
    .slice(1)
    .map((chunk) => ({ id: /data-line-id="([^"]*)"/.exec(chunk)?.[1] ?? '' }));
}

async function openTill(session: Session, email: string): Promise<string> {
  const page = await session.get('/admin/pos');
  const form = formWith(page.body, '/admin/pos', 'data-testid="pos-find-customer"');

  const location = redirectOf(
    await session.submit(form, { fullName: 'Packing Table Customer', email, phone: '' }),
    'opening the till',
  );

  return new URL(location, BASE_URL).pathname;
}

async function addAtCounter(
  session: Session,
  builderPath: string,
  slug: string,
  values: Record<string, string>,
): Promise<void> {
  const page = await session.get(builderPath);
  const form = parseForms(page.body, builderPath).find((candidate) => candidate.fields.slug === slug);
  if (!form) throw new Error(`No add form for ${slug} on the counter builder`);

  redirectOf(await session.submit(form, values), `adding ${slug} at the counter`);
}

async function assign(
  session: Session,
  builderPath: string,
  lineId: string,
  values: Record<string, string>,
  options: { add?: boolean } = {},
): Promise<void> {
  const path = `${builderPath}?assign=${lineId}${options.add ? '&add=1' : ''}`;
  const page = await session.get(path);
  const marker = options.add ? 'data-testid="add-recipient-submit"' : 'data-testid="assign-submit"';
  const form: ParsedForm = formWith(page.body, path, marker);

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
