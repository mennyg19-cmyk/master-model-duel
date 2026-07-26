import { PrismaClient } from '@prisma/client';

import { DATABASE_URL, TEST_DATABASE_URL } from './db-server';
import { parseForms, Session } from './http-form';
import { envWithoutDatabaseUrl, runCommand, runTests, SmokeRun } from './smoke-harness';
import { dollars, formWith, redirectOf } from './smoke-p4-helpers';

/**
 * Phase P8 smoke run: carriage.
 *
 * A counter order is shipped to a real address, and the run follows the money
 * the whole way — the rates the carriers quoted, the highest one charged to the
 * customer, the cheapest one the label was bought on, the spread recorded, the
 * label cancelled on a reroute and bought again. Every step is a real HTTP
 * request against the running app or a database read of what it did.
 *
 * The carrier behind it is the offline stand-in (SHIPPING_PROVIDER=local), which
 * is the same code path as Shippo with carriers that do not exist. That is the
 * only way to buy and cancel labels several times in a smoke run without
 * spending the organization's money.
 *
 * Expects `npm run dev` up on 3104 against the seeded database.
 */
const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3104';

const MANAGER_EMAIL = 'manager@tomchei.example';
const DRIVER_EMAIL = 'driver@tomchei.example';

const CLASSIC = 'classic-mishloach-manos';
const BOARD = '/admin/fulfillment/packages';
const SHIPPING_SETTINGS = '/admin/settings/shipping';

const ZIMMER = {
  recipientName: 'Aaron Zimmer',
  line1: '88 Yeshiva Lane',
  line2: '',
  city: 'Monsey',
  state: 'NY',
  postalCode: '10952',
  phone: '',
  label: '',
};

const TEST_FILES = ['tests/shipping.test.ts'];

const db = new PrismaClient({ datasourceUrl: DATABASE_URL });

const run = new SmokeRun('P8', [
  `Run at ${new Date().toISOString()} against ${BASE_URL} (web 3104, db 4104).`,
  'Carriage is provided by the offline stand-in, which is the same rate-shopping,',
  'margin, label and void code path as Shippo with imaginary carriers behind it.',
]);

const record = run.record.bind(run);
const expect = run.expect.bind(run);
const expectTest = run.expectTest.bind(run);

async function main() {
  const methods = await db.fulfillmentMethod.findMany({ where: { isActive: true } });
  const shipMethodId = methods.find((row) => row.code === 'ship')!.id;

  await db.order.deleteMany({ where: { status: 'DRAFT', posStaffUserId: { not: null } } });

  const manager = new Session(BASE_URL);
  await signInStaff(manager, MANAGER_EMAIL);

  // ------------------------------------------------- S0 the origin is set up
  const settings = await manager.get(SHIPPING_SETTINGS);
  const origin = await db.setting.findUniqueOrThrow({ where: { key: 'shipping.origin' } });

  expect('S0', 'The ship-from address is configurable and configured',
    settings.status === 200 &&
      settings.body.includes('data-testid="shipping-origin"') &&
      (origin.value as { postalCode: string }).postalCode !== '',
    `Settings → Shipping carries the ship-from address (${(origin.value as { city: string; postalCode: string }).city} ${(origin.value as { postalCode: string }).postalCode}); without it no carrier can be asked and shipping falls back to the flat rate`);

  // -------------------------------------------- S1 margin math through checkout
  const walkInEmail = `carriage-${Date.now()}@example.test`;
  const builderPath = await openTill(manager, walkInEmail);
  const customer = await db.customer.findUniqueOrThrow({ where: { normalizedEmail: walkInEmail } });

  await addAtCounter(manager, builderPath, CLASSIC, { quantity: '1', 'option:Size': 'Standard' });

  const lines = counterLines((await manager.get(builderPath)).body);
  await assign(manager, builderPath, lines[0].id, {
    target: 'new',
    ...ZIMMER,
    fulfillmentMethodId: shipMethodId,
    greetingMessage: '',
  });

  const checkoutPath = `${builderPath}/checkout`;
  const checkout = await manager.get(checkoutPath);
  await manager.submit(formWith(checkout.body, checkoutPath, 'data-testid="pos-sell"'), {
    method: 'CASH',
    reference: 'Drawer 1',
  });

  const order = await db.order.findFirstOrThrow({
    where: { customerId: customer.id, status: 'PLACED' },
    include: { packages: true },
  });
  const box = order.packages[0];

  // Latest first: a box that has been labelled carries a second quote row from
  // the buy, and that one is the canonical record of the rates in play.
  const quote = await db.shippingQuote.findFirstOrThrow({
    where: { packageId: box.id },
    orderBy: { requestedAt: 'desc' },
    include: { options: { orderBy: { carrierCostCents: 'asc' } } },
  });
  const eligible = quote.options.filter((option) => option.isEligible);
  const cheapest = eligible[0];
  const dearest = eligible[eligible.length - 1];

  expect('S1a', 'Every carrier the org can ship with is quoted, and the customer is charged the highest',
    quote.source === 'LIVE' &&
      eligible.length >= 2 &&
      box.fulfillmentFeeCents === dearest.carrierCostCents &&
      quote.customerPriceCents === box.fulfillmentFeeCents &&
      cheapest.carrierCostCents < dearest.carrierCostCents,
    `${quote.options.length} rates for ${quote.destinationPostalCode} (${quote.options.map((option) => `${option.carrier} ${dollars(option.carrierCostCents)}`).join(', ')}); the box was charged ${dollars(box.fulfillmentFeeCents)} — the highest — and the order totals ${dollars(order.totalCents)}`);

  expect('S1b', 'The label is bought on the cheapest eligible carrier, and the spread is recorded exactly',
    cheapest.isSelected &&
      eligible.filter((option) => option.isSelected).length === 1 &&
      cheapest.providerRateId !== null,
    `${cheapest.carrier} ${cheapest.serviceLabel} at ${dollars(cheapest.carrierCostCents)} is marked as the one the label goes on, against rate id ${cheapest.providerRateId}; the spread the campaign keeps is ${dollars(dearest.carrierCostCents - cheapest.carrierCostCents)}`);

  const packagePath = `${BOARD}/${box.id}`;
  const boardPage = await manager.get(packagePath);
  const bought = flashOf(
    await manager.submit(formWith(boardPage.body, packagePath, 'data-testid="buy-label"')),
  );

  const parcels = await db.shipmentBox.findMany({ where: { packageId: box.id } });
  const purchased = parcels.filter((parcel) => parcel.status === 'PURCHASED');
  const marginAudit = await db.auditEvent.findFirstOrThrow({
    where: { action: 'shipping.label_purchased', entityId: box.id },
  });
  const detail = marginAudit.detail as {
    carrierCostCents: number;
    customerPriceCents: number;
    marginCents: number;
    carrier: string;
  };

  expect('S1c', 'Buying the label spends the cheapest rate and stores the margin on the parcel',
    purchased.length === 1 &&
      purchased[0].carrier === cheapest.carrier &&
      purchased[0].carrierCostCents === cheapest.carrierCostCents &&
      purchased[0].customerPriceCents === box.fulfillmentFeeCents &&
      purchased[0].marginCents === box.fulfillmentFeeCents - cheapest.carrierCostCents &&
      detail.marginCents === purchased[0].marginCents &&
      purchased[0].providerTransactionId !== null,
    `"${bought}" — ${purchased[0].carrier} ${purchased[0].trackingNumber}: ${dollars(purchased[0].carrierCostCents!)} paid, ${dollars(purchased[0].customerPriceCents!)} charged, ${dollars(purchased[0].marginCents!)} recorded for reconciliation, and the same three numbers are in the audit row against ${marginAudit.actorLabel}`);

  const afterBuy = await manager.get(packagePath);
  const secondBuy = problemOf(
    await manager.submit(formWith(afterBuy.body, packagePath, 'data-testid="buy-label"')),
  );

  expect('S1d', 'A box that already has a label cannot be paid for twice',
    secondBuy.includes('already has a label') &&
      (await db.shipmentBox.count({ where: { packageId: box.id, status: 'PURCHASED' } })) === 1,
    `replaying the buy form answers "${secondBuy}" and the box still has exactly one live label (R-175)`);

  // ----------------------------------------------- S2 tracking, void and rebuy
  const trackPage = await manager.get(packagePath);
  const tracked = flashOf(
    await manager.submit(formWith(trackPage.body, packagePath, 'data-testid="refresh-tracking"')),
  );
  const afterTracking = await db.shipmentBox.findFirstOrThrow({ where: { id: purchased[0].id } });

  expect('S2a', 'Tracking is asked for on demand and written down with the time it was asked',
    tracked !== '' &&
      afterTracking.trackingStatus !== null &&
      afterTracking.trackingCheckedAt !== null,
    `R-176: "${tracked}" — the box now reads "${afterTracking.trackingStatus}", asked at ${afterTracking.trackingCheckedAt?.toISOString()}`);

  const addressPage = await manager.get(packagePath);
  const verdict = flashOf(
    await manager.submit(formWith(addressPage.body, packagePath, 'data-testid="validate-address"')),
  );
  const checkedBox = await db.package.findUniqueOrThrow({ where: { id: box.id } });

  expect('S2b', 'The carrier is asked whether the destination exists, and the answer is kept on the box',
    verdict !== '' &&
      checkedBox.addressValidatedAt !== null &&
      checkedBox.addressIsValid !== null,
    `R-177: "${verdict}" — ${ZIMMER.line1}, ${ZIMMER.city} ${ZIMMER.postalCode} came back ${checkedBox.addressIsValid ? 'deliverable' : 'unmatched'}, advisory only`);

  // Printed paper is not a shipped box: this is the state a P9 reroute finds.
  await manager.submit(
    formWith((await manager.get(packagePath)).body, packagePath, 'data-testid="advance-stage"'),
    { stage: 'PRINTED' },
  );

  const printedBox = await db.package.findUniqueOrThrow({ where: { id: box.id } });
  const voidPage = await manager.get(packagePath);
  const voided = flashOf(
    await manager.submit(formWith(voidPage.body, packagePath, 'data-testid="void-label"'), {
      reason: 'Rerouted onto a volunteer run',
    }),
  );

  const cancelled = await db.shipmentBox.findFirstOrThrow({ where: { id: purchased[0].id } });
  const voidAudit = await db.auditEvent.findFirstOrThrow({
    where: { action: 'shipping.label_voided', entityId: box.id },
  });

  expect('S3a', 'A printed but unshipped box can still have its label cancelled',
    printedBox.stage === 'PRINTED' &&
      printedBox.sentAt === null &&
      cancelled.status === 'VOIDED' &&
      cancelled.voidedAt !== null &&
      cancelled.voidReason === 'Rerouted onto a volunteer run',
    `R-055, UR-004: the box is Printed with no sent stamp, and "${voided}" — the label is cancelled with the reason on the row and on the audit trail (${(voidAudit.detail as { reason: string }).reason})`);

  const rebuyPage = await manager.get(packagePath);
  const rebought = flashOf(
    await manager.submit(formWith(rebuyPage.body, packagePath, 'data-testid="buy-label"')),
  );

  const live = await db.shipmentBox.findMany({
    where: { packageId: box.id, status: 'PURCHASED' },
  });
  const history = await db.shipmentBox.count({ where: { packageId: box.id } });

  expect('S3b', 'With the old label dead the box can be labelled again, and the cancelled one stays on the record',
    live.length === 1 &&
      live[0].id !== cancelled.id &&
      live[0].trackingNumber !== cancelled.trackingNumber &&
      history === 2,
    `"${rebought}" — a new label (${live[0].trackingNumber}) on a box that had one cancelled; both rows survive so the carrier charge can be reconciled`);

  const sentBox = await manager.get(packagePath);
  await manager.submit(formWith(sentBox.body, packagePath, 'data-testid="advance-stage"'), {
    stage: 'SENT',
  });

  const tooLate = problemOf(
    await manager.submit(formWith(voidPage.body, packagePath, 'data-testid="void-label"'), {
      reason: 'changed my mind',
    }),
  );
  const stillLive = await db.shipmentBox.count({
    where: { packageId: box.id, status: 'PURCHASED' },
  });

  expect('S3c', 'Once the box has gone out its label is settled',
    tooLate.includes('already gone out') && stillLive === 1,
    `the void form replayed against a Sent box answers "${tooLate}", and the label is still live rather than half-cancelled`);

  const driver = new Session(BASE_URL);
  await signInStaff(driver, DRIVER_EMAIL);
  const driverBoard = await driver.get(packagePath);

  expect('S3d', 'Carriage is behind the packing permission',
    driverBoard.status === 403,
    `${DRIVER_EMAIL} is refused the box screen (${driverBoard.status}), so the buy and void forms are not reachable by someone who only drives`);

  // ----------------------------------------------------- unit test citations
  const testRun = runTests(TEST_FILES, TEST_DATABASE_URL);
  const passedTests = new Set(testRun.passed);

  expectTest('P8-1', 'Bin packing and the margin engine are covered by unit tests', passedTests, [
    'a box goes in the smallest carton it fits, and spills into more when it does not',
    'the customer pays the highest quote and the label is bought on the cheapest',
    'money split across parcels still adds up to the cent',
  ]);

  expectTest('P8-2', 'Live quoting and its fallback are covered by unit tests', passedTests, [
    'checkout charges the carrier quote, and the quote is filed with the order',
    'an unconfigured origin prices shipping at the flat rate instead of closing the store',
  ]);

  expectTest('P8-3', 'Labels, voiding, tracking and address checks are covered by unit tests', passedTests, [
    'buying a label spends once, records the spread, and cannot be done twice',
    'the recorded margin is the fee the customer was charged, not a rate that moved since',
    'tracking is asked for, and a label can be cancelled until the box goes out',
    'a box with no carrier rate is refused a label rather than sent unlabelled',
    'the carrier is asked whether the address exists, and the answer is advisory',
  ]);

  record('P8-4', 'The P8 test file is green', testRun.failed.length === 0,
    `${testRun.passed.length} tests passed, ${testRun.failed.length} failed`);

  const ci = runCommand('npm', ['run', 'ci'], envWithoutDatabaseUrl());
  record('P8-5', 'Lint, typecheck, migration guard and the whole suite pass', ci.status === 0,
    ci.status === 0 ? 'npm run ci exited 0' : ci.output.trim().split('\n').slice(-6).join(' / '));

  run.write();
}

/** The notice a server action redirected back with, as staff would read it. */
function flashOf(response: Response): string {
  return flashParam(response, 'notice');
}

function problemOf(response: Response): string {
  return flashParam(response, 'problem');
}

function flashParam(response: Response, name: string): string {
  const location = response.headers.get('location') ?? '';
  const found = new RegExp(`[?&]${name}=([^&]*)`).exec(location)?.[1] ?? '';

  return decodeURIComponent(found.replaceAll('+', ' '));
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
    await session.submit(form, { fullName: 'Carriage Customer', email, phone: '' }),
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
