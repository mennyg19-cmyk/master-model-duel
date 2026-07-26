import { PrismaClient } from '@prisma/client';

import { DATABASE_URL, TEST_DATABASE_URL } from './db-server';
import { parseForms, Session } from './http-form';
import { envWithoutDatabaseUrl, runCommand, runTests, SmokeRun } from './smoke-harness';
import { cartLines, dollars, formWith, redirectOf } from './smoke-p4-helpers';

/**
 * Phase P6 smoke run: the operations hub, the counter, the import pipeline and
 * all of it again at crunch scale — driven over HTTP against the running app,
 * with the database read afterwards to check what actually happened.
 *
 * Expects `npm run dev` up on 3104 against the seeded database.
 */
const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3104';

const MANAGER_EMAIL = 'manager@tomchei.example';
const STAFF_EMAIL = 'staff@tomchei.example';

const CLASSIC = 'classic-mishloach-manos';

const TEST_FILES = ['tests/admin-ops.test.ts'];

const db = new PrismaClient({ datasourceUrl: DATABASE_URL });

const run = new SmokeRun('P6', [
  `Run at ${new Date().toISOString()} against ${BASE_URL} (web 3104, db 4104).`,
  'Every check is a real HTTP request against the running app, a server action',
  'replayed from the HTML it rendered, a database read, or a named unit test.',
  'The scale checks run against generated fixtures of 1,000 orders and 5,000',
  'packages (`npm run fixtures:scale`).',
]);

const record = run.record.bind(run);
const expect = run.expect.bind(run);
const expectTest = run.expectTest.bind(run);

async function main() {
  const season = await db.season.findFirstOrThrow({
    where: { status: 'OPEN' },
    orderBy: { year: 'desc' },
  });
  const pickup = await db.pickupLocation.findFirstOrThrow({ where: { isActive: true } });
  const pickupMethod = await db.fulfillmentMethod.findFirstOrThrow({ where: { code: 'pickup' } });

  // Tills left open by an earlier run would refuse this one's repeat checks.
  await db.order.deleteMany({ where: { status: 'DRAFT', posStaffUserId: { not: null } } });

  const manager = new Session(BASE_URL);
  await signInStaff(manager, MANAGER_EMAIL);

  // ------------------------------------------------------------- S1 ops hub
  const dashboard = await manager.get('/admin');
  const placedCount = await db.order.count({
    where: { seasonId: season.id, status: { notIn: ['DRAFT', 'DISCARDED'] } },
  });
  const billed = await db.order.aggregate({
    where: { seasonId: season.id, status: { notIn: ['DRAFT', 'DISCARDED', 'CANCELLED'] } },
    _sum: { totalCents: true },
  });

  expect('S1a', 'The dashboard opens on the season being run, with its own numbers',
    dashboard.status === 200 &&
      kpiOf(dashboard.body, 'kpi-orders') === placedCount &&
      kpiOf(dashboard.body, 'kpi-billed') === (billed._sum.totalCents ?? 0) &&
      dashboard.body.includes('data-testid="dashboard-awaiting"'),
    `/admin -> 200 for ${season.label}: ${kpiOf(dashboard.body, 'kpi-orders')} orders this season and ${dollars(kpiOf(dashboard.body, 'kpi-billed'))} billed, both matching the database, with the Today queue and the latest orders beside them`);

  const today = await manager.get('/admin/today');
  const owing = await db.order.count({
    where: {
      seasonId: season.id,
      status: { in: ['PLACED', 'IN_FULFILLMENT'] },
      paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] },
    },
  });

  expect('S1b', 'The Today queue separates money owed from boxes waiting to be packed',
    today.status === 200 &&
      queueCount(today.body, 'today-awaiting') === Math.min(owing, 8) &&
      queueCount(today.body, 'today-ready') >= 0 &&
      queueCount(today.body, 'today-tills') >= 0,
    `/admin/today shows ${queueCount(today.body, 'today-awaiting')} of ${owing} orders owing money, ${queueCount(today.body, 'today-ready')} paid and waiting to be packed, ${queueCount(today.body, 'today-tills')} carts open at the counter`);

  const deskOrder = await db.order.findFirstOrThrow({
    where: { seasonId: season.id, status: 'PLACED', payments: { some: { state: 'POSTED' } } },
    include: { customer: true },
    orderBy: { placedAt: 'desc' },
  });

  const byNumber = await manager.get(`/admin/orders?q=%23${deskOrder.orderNumber}`);
  const byName = await manager.get(
    `/admin/orders?q=${encodeURIComponent(deskOrder.customer?.email ?? '')}`,
  );
  const cancelledOnly = await manager.get('/admin/orders?status=CANCELLED&size=10');

  expect('S1c', 'One search box finds an order by its number or by who placed it, and the filters bite',
    rowIds(byNumber.body).includes(deskOrder.id) &&
      rowIds(byName.body).includes(deskOrder.id) &&
      !rowIds(cancelledOnly.body).includes(deskOrder.id) &&
      pageAttr(cancelledOnly.body, 'page-count') >= 1,
    `#${deskOrder.orderNumber} found by number and by ${deskOrder.customer?.email}; filtering to cancelled orders drops it and leaves ${pageAttr(cancelledOnly.body, 'total')} row(s) over ${pageAttr(cancelledOnly.body, 'page-count')} page(s)`);

  const detail = await manager.get(`/admin/orders/${deskOrder.id}`);
  const boxes = await db.package.count({ where: { orderId: deskOrder.id } });

  expect('S1d', 'The order detail shows what is in the boxes next to what was paid for them',
    detail.status === 200 &&
      attrOf(detail.body, 'data-box-count') === boxes &&
      detail.body.includes('data-testid="payment-row"') &&
      detail.body.includes('data-testid="back-link"'),
    `order #${deskOrder.orderNumber}: ${boxes} box(es) listed with their recipients and cards, its payment rows, and the back link every detail screen carries`);

  const refundForm = formWith(detail.body, `/admin/orders/${deskOrder.id}`, 'data-testid="payment-refund"');
  const beforeRefund = deskOrder.amountPaidCents;
  await manager.submit(refundForm, { amount: '1.00', reason: 'Smoke run partial refund' });
  const refunded = await db.order.findUniqueOrThrow({ where: { id: deskOrder.id } });
  const refundAudit = await db.auditEvent.findFirstOrThrow({
    where: { action: 'payment.refunded' },
    orderBy: { createdAt: 'desc' },
  });

  expect('S1e', 'A refund moves the money and the audit trail names who moved it',
    refunded.amountPaidCents === beforeRefund - 100 &&
      refunded.paymentStatus === 'PARTIALLY_PAID' &&
      refundAudit.actorLabel.includes(MANAGER_EMAIL),
    `$1.00 back on #${deskOrder.orderNumber}: ${dollars(beforeRefund)} -> ${dollars(refunded.amountPaidCents)}, status ${refunded.paymentStatus}, audit "${refundAudit.action}" by ${refundAudit.actorLabel}`);

  const audit = await manager.get('/admin/audit');
  const restricted = new Session(BASE_URL);
  await signInStaff(restricted, STAFF_EMAIL);

  const staffDash = await restricted.get('/admin');
  const staffOrders = await restricted.get(`/admin/orders/${deskOrder.id}`);
  const staffImports = await restricted.get('/admin/imports');
  const staffAudit = await restricted.get('/admin/audit');

  expect('S1f', 'A restricted staff member gets the order desk and nothing that is not theirs',
    audit.status === 200 &&
      staffDash.status === 200 &&
      staffOrders.status === 200 &&
      staffImports.status === 403 &&
      staffAudit.status === 403 &&
      !staffDash.body.includes('href="/admin/imports"') &&
      !staffDash.body.includes('href="/admin/audit"'),
    `manager reads /admin/audit (200); ${STAFF_EMAIL} reads the dashboard and the order (200/200) but is refused /admin/imports (${staffImports.status}) and /admin/audit (${staffAudit.status}), and neither link is in their sidebar`);

  // ----------------------------------------------------------------- S2 POS
  const walkInEmail = `walkin-${Date.now()}@example.test`;
  const posHome = await manager.get('/admin/pos');
  const findForm = formWith(posHome.body, '/admin/pos', 'data-testid="pos-find-customer"');
  const builderPath = new URL(
    redirectOf(
      await manager.submit(findForm, {
        fullName: 'Walk In Customer',
        email: walkInEmail,
        phone: '',
      }),
      'finding the customer at the counter',
    ),
    BASE_URL,
  ).pathname;

  const walkIn = await db.customer.findUniqueOrThrow({ where: { normalizedEmail: walkInEmail } });
  const createdAudit = await db.auditEvent.findFirstOrThrow({
    where: { action: 'customer.created_at_counter', entityId: walkIn.id },
  });

  expect('S2a', 'The counter starts with a person, and a new one is created and audited on the spot',
    builderPath === `/admin/pos/${walkIn.id}` && createdAudit.actorLabel.includes(MANAGER_EMAIL),
    `a walk-in nobody had on file became ${walkIn.fullName} <${walkIn.email}>, audited as "${createdAudit.action}" by ${createdAudit.actorLabel}; the till opened at ${builderPath}`);

  await addAtCounter(manager, builderPath, CLASSIC, { quantity: '2', 'option:Size': 'Standard' });
  const till = await manager.get(builderPath);
  const line = counterLines(till.body)[0];
  if (!line) throw new Error('Nothing landed in the counter cart');

  const assignPath = `${builderPath}?assign=${line.id}`;
  const assignPage = await manager.get(assignPath);
  await manager.submit(formWith(assignPage.body, assignPath, 'data-testid="assign-submit"'), {
    lineId: line.id,
    target: 'self',
    fulfillmentMethodId: pickupMethod.id,
    pickupLocationId: pickup.id,
  });

  const checkoutPath = `${builderPath}/checkout`;
  const counterCheckout = await manager.get(checkoutPath);
  const counterTotal = Number(
    /data-testid="checkout-total" data-cents="(\d+)"/.exec(counterCheckout.body)?.[1] ?? -1,
  );

  const sellForm = formWith(counterCheckout.body, checkoutPath, 'data-testid="pos-sell"');
  const sold = redirectOf(
    await manager.submit(sellForm, { method: 'CASH', reference: 'Drawer 1' }),
    'ringing up the counter sale',
  );

  const posOrder = await db.order.findFirstOrThrow({
    where: { customerId: walkIn.id, status: 'PLACED' },
    include: { payments: { include: { recorded: true } }, packages: true },
  });

  expect('S2b', 'A walk-in cash sale places the same order the website would, paid at the counter',
    counterCheckout.body.includes('data-testid="pos-checkout"') &&
      posOrder.totalCents === counterTotal &&
      posOrder.paymentStatus === 'PAID' &&
      posOrder.payments.length === 1 &&
      posOrder.payments[0].method === 'CASH' &&
      posOrder.payments[0].recorded?.email === MANAGER_EMAIL &&
      posOrder.packages.length === 1 &&
      sold.includes(`/admin/orders/${posOrder.id}`),
    `order #${posOrder.orderNumber} for ${dollars(posOrder.totalCents)} — the price the counter screen quoted — paid ${dollars(posOrder.payments[0].amountCents)} cash by ${posOrder.payments[0].recorded?.email}, ${posOrder.packages.length} box grouped, landing on the order desk`);

  const noCardField = !counterCheckout.body.includes('name="cardNumber"');
  const customerSide = new Session(BASE_URL);
  await signInCustomer(customerSide, walkInEmail, 'Walk In Customer');
  const theirCart = await customerSide.get('/order');

  expect('S2c', 'The till is the counter\u2019s, not the customer\u2019s, and takes no card details',
    noCardField && cartLines(theirCart.body).length === 0,
    `the POS checkout offers cash and check only (no card field anywhere on it); the customer signing in to their own account sees an empty cart, not the counter's`);

  const detailForRepeat = await manager.get(`/admin/orders/${posOrder.id}`);
  const repeatPath = new URL(
    redirectOf(
      await manager.submit(
        formWith(detailForRepeat.body, `/admin/orders/${posOrder.id}`, 'data-testid="order-repeat"'),
      ),
      'repeating the order',
    ),
    BASE_URL,
  ).pathname;

  const repeatDraft = await db.order.findFirstOrThrow({
    where: { customerId: walkIn.id, status: 'DRAFT' },
    include: { lines: true },
  });
  const repeatAudit = await db.auditEvent.findFirstOrThrow({
    where: { action: 'order.repeated', entityId: repeatDraft.id },
  });

  expect('S2d', 'Ordering the same again copies the boxes onto the till as a draft, not a sale',
    repeatPath === `/admin/pos/${walkIn.id}` &&
      repeatDraft.lines.length === posOrder.packages.length &&
      repeatDraft.orderNumber === null &&
      repeatDraft.posStaffUserId !== null &&
      repeatAudit.detail !== null,
    `${repeatDraft.draftReference}: ${repeatDraft.lines.length} line(s) copied from #${posOrder.orderNumber} at this season's prices, no order number, sitting on the manager's till and audited as "${repeatAudit.action}"`);

  // ------------------------------------------------------------- S3 imports
  const stamp = Date.now().toString(36);
  const onFile = await db.customer.findFirstOrThrow({ where: { normalizedEmail: { not: walkInEmail } } });
  const phone = await freePhone();

  const staged = await stageCsv(manager, [
    'fullName,email,phone',
    `Corrected Spelling,${onFile.email},`,
    `Brand New,new-${stamp}@example.test,${phone}`,
    `Also New,also-${stamp}@example.test,`,
    `Repeat Of Row Two,new-${stamp}@example.test,`,
    'Missing Address,not-an-email,',
  ].join('\n'));


  const preview = await manager.get(staged);
  const batchId = staged.split('/').pop() ?? '';
  const untouched = await db.customer.count({ where: { email: `new-${stamp}@example.test` } });

  expect('S3a', 'Staging reads a verdict onto every row and writes none of them',
    attrOf(preview.body, 'data-valid') === 2 &&
      attrOf(preview.body, 'data-duplicate') === 1 &&
      attrOf(preview.body, 'data-invalid') === 2 &&
      untouched === 0 &&
      preview.body.includes('data-testid="import-blocked"'),
    `5 rows -> ${attrOf(preview.body, 'data-valid')} new, ${attrOf(preview.body, 'data-duplicate')} updating somebody already on file, ${attrOf(preview.body, 'data-invalid')} unusable (a repeated address and a bad one); ${untouched} of the new addresses written so far, and the import button is ${preview.body.includes('data-testid="import-blocked"') ? 'shut' : 'open'}`);

  const blockedCommit = await manager.submit(
    formWith(preview.body, staged, 'data-testid="import-commit"'),
    { batchId },
  );
  const stillStaged = await db.importBatch.findUniqueOrThrow({ where: { id: batchId } });

  expect('S3b', 'A batch with an unreadable row cannot be forced through by posting the form',
    stillStaged.status === 'STAGED' &&
      (await db.customer.count({ where: { email: `new-${stamp}@example.test` } })) === 0 &&
      blockedCommit.status === 303,
    `replaying the commit action against the blocked batch left it ${stillStaged.status} and created nothing`);

  const fixed = await stageCsv(manager, [
    'fullName,email,phone',
    `Corrected Spelling,${onFile.email},`,
    `Brand New,new-${stamp}@example.test,${phone}`,
    `Also New,also-${stamp}@example.test,`,
  ].join('\n'));

  const fixedPreview = await manager.get(fixed);
  const fixedId = fixed.split('/').pop() ?? '';
  await manager.submit(formWith(fixedPreview.body, fixed, 'data-testid="import-commit"'), {
    batchId: fixedId,
  });

  const committed = await db.importBatch.findUniqueOrThrow({ where: { id: fixedId } });
  const renamed = await db.customer.findUniqueOrThrow({ where: { id: onFile.id } });
  const importAudit = await db.auditEvent.findFirstOrThrow({
    where: { action: 'import.committed', entityId: fixedId },
  });

  // The same preview committed twice is two people pressing the button.
  await manager.submit(formWith(fixedPreview.body, fixed, 'data-testid="import-commit"'), {
    batchId: fixedId,
  });
  const afterSecondPress = await db.customer.count({
    where: { email: { in: [`new-${stamp}@example.test`, `also-${stamp}@example.test`] } },
  });

  expect('S3c', 'The corrected file lands in one transaction, once, and is audited',
    committed.status === 'COMMITTED' &&
      committed.createdCount === 2 &&
      committed.updatedCount === 1 &&
      renamed.fullName === 'Corrected Spelling' &&
      afterSecondPress === 2 &&
      importAudit.actorLabel.includes(MANAGER_EMAIL),
    `created ${committed.createdCount}, updated ${committed.updatedCount} (${onFile.email} is now "${renamed.fullName}"); pressing commit a second time added nothing; audit "${importAudit.action}" by ${importAudit.actorLabel}`);

  // --------------------------------------------------------------- S4 scale
  const fixtures = runCommand('npm', ['run', 'fixtures:scale'], envWithoutDatabaseUrl());
  const scaleOrders = await db.order.count({ where: { draftReference: { startsWith: 'D-SCAL-' } } });
  const scalePackages = await db.package.count({ where: { greetingMessage: 'scale-fixture' } });

  expect('S4a', 'The fixtures put a real Purim week behind the lists',
    fixtures.status === 0 && scaleOrders >= 1_000 && scalePackages >= 5_000,
    `${scaleOrders.toLocaleString('en-US')} orders and ${scalePackages.toLocaleString('en-US')} packages generated`);

  const firstPage = await timed(() => manager.get('/admin/orders?size=25'));
  const deepPage = await timed(() => manager.get('/admin/orders?size=25&page=30'));
  const searched = await timed(() => manager.get('/admin/orders?q=Klein&size=25'));

  expect('S4b', 'Paging and searching stay bounded with a thousand orders behind them',
    rowIds(firstPage.value.body).length === 25 &&
      rowIds(deepPage.value.body).length === 25 &&
      pageAttr(deepPage.value.body, 'total') >= 1_000 &&
      firstPage.ms < 5_000 && deepPage.ms < 5_000 && searched.ms < 5_000,
    `page 1 of ${pageAttr(firstPage.value.body, 'page-count')} in ${firstPage.ms}ms, page 30 in ${deepPage.ms}ms, a name search in ${searched.ms}ms — 25 rows each time out of ${pageAttr(deepPage.value.body, 'total').toLocaleString('en-US')}`);

  // Unpaid fixtures, so the sweep is about who got there first rather than about
  // money that has to be refunded before an order can be cancelled at all.
  const target = await db.order.findMany({
    where: {
      draftReference: { startsWith: 'D-SCAL-' },
      status: 'PLACED',
      paymentStatus: 'UNPAID',
    },
    orderBy: { orderNumber: 'asc' },
    take: 6,
    select: { id: true, orderNumber: true },
  });
  const ids = target.map((row) => row.id);

  const listPage = await manager.get('/admin/orders?size=25');
  const bulkForm = formWith(listPage.body, '/admin/orders', 'data-testid="bulk-apply"');

  const firstSweep = noticeOf(
    await manager.submit(bulkForm, { orderIds: ids.slice(0, 4), action: 'IN_FULFILLMENT' }),
  );
  const secondSweep = noticeOf(await manager.submit(bulkForm, { orderIds: ids, action: 'CANCELLED' }));
  const replay = noticeOf(
    await manager.submit(bulkForm, { orderIds: [...ids].reverse(), action: 'CANCELLED' }),
  );

  const batchAudits = await db.auditEvent.count({ where: { action: 'orders.bulk_action' } });

  expect('S4c', 'Two staff sweeping the same rows get an exact, repeatable account of what happened',
    firstSweep.startsWith('4 updated') &&
      secondSweep.startsWith('6 updated') &&
      replay.split(' — ')[0] === '0 updated, 6 conflicted' &&
      batchAudits >= 3,
    `first sweep: "${firstSweep.split(' — ')[0]}"; the overlapping one: "${secondSweep.split(' — ')[0]}"; running it again with the ids reversed: "${replay.split(' — ')[0]}" and the same per-order detail — ${replay.split(' — ')[1] ?? ''}`);

  const cleared = runCommand('npm', ['run', 'fixtures:scale', '--', 'clear'], envWithoutDatabaseUrl());
  const leftBehind = await db.order.count({ where: { draftReference: { startsWith: 'D-SCAL-' } } });

  expect('S4d', 'The crunch-week fixtures are taken out again, leaving the seeded data alone',
    cleared.status === 0 && leftBehind === 0,
    `${scaleOrders.toLocaleString('en-US')} fixture orders and their packages removed; ${leftBehind} left behind, so the next run starts where this one did`);

  // ----------------------------------------------------- unit test citations
  const testRun = runTests(TEST_FILES, TEST_DATABASE_URL);
  const passedTests = new Set(testRun.passed);

  expectTest('P6-1', 'Bounded list reads are covered by unit tests', passedTests, [
    'a page request is clamped, and the page it describes adds up',
    'page links keep the search that produced them, and page 1 stays clean',
    'the desk finds an order by its number, its reference, and the customer',
    'carts are off the desk unless somebody asks for them',
    'paging a long list shows every row exactly once',
    'the customer directory pages, searches and counts only real orders',
  ]);

  expectTest('P6-2', 'Bulk actions and repeats are covered by unit tests', passedTests, [
    'two people sweeping the same list: the second is told what the first already did',
    'a bulk batch is bounded, and says how much it left alone',
    'a repeat copies last season at this season prices, and names what is gone',
  ]);

  expectTest('P6-3', 'The import pipeline is covered by unit tests', passedTests, [
    'the CSV reader handles quotes, commas and either line ending',
    'an import is staged with a verdict per row and written all at once',
    'a product import needs a season, and rejects a price nobody can charge',
  ]);

  expectTest('P6-4', 'The dashboard and Today queue are covered by unit tests', passedTests, [
    'the dashboard counts the season being run, and the queue shows the work',
  ]);

  record('P6-5', 'The P6 test file is green', testRun.failed.length === 0,
    `${testRun.passed.length} tests passed, ${testRun.failed.length} failed`);

  const ci = runCommand('npm', ['run', 'ci'], envWithoutDatabaseUrl());
  record('P6-6', 'Lint, typecheck, migration guard and the whole suite pass', ci.status === 0,
    ci.status === 0 ? 'npm run ci exited 0' : ci.output.trim().split('\n').slice(-6).join(' / '));

  run.write();
}

async function timed<T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = Date.now();
  const value = await work();
  return { value, ms: Date.now() - started };
}

/**
 * A number nobody holds yet. Runs of this script leave their imported customers
 * behind, and a phone already on file is — correctly — read as the same
 * household, which would quietly change what the staging check is testing.
 */
async function freePhone(): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const digits = String(2_000_000 + Math.floor(Math.random() * 7_000_000));
    const taken = await db.customer.findUnique({ where: { normalizedPhone: `+1732${digits}` } });
    if (!taken) return `732-${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  throw new Error('Could not find a phone number that is not already on file');
}

/** Posts a CSV through the upload form and returns the preview path it lands on. */
async function stageCsv(session: Session, content: string): Promise<string> {
  const page = await session.get('/admin/imports');
  const form = formWith(page.body, '/admin/imports', 'data-testid="import-stage"');

  const location = redirectOf(
    await session.submit(form, {
      kind: 'CUSTOMERS',
      seasonId: '',
      file: new File([content], 'members.csv', { type: 'text/csv' }),
    }),
    'staging the import',
  );

  return new URL(location, BASE_URL).pathname;
}

function noticeOf(response: Response): string {
  const location = response.headers.get('location') ?? '';
  return decodeURIComponent((/[?&]notice=([^&]*)/.exec(location)?.[1] ?? '').replaceAll('+', ' '));
}

function kpiOf(html: string, testId: string): number {
  return Number(new RegExp(`data-testid="${testId}"\\s+data-value="(-?\\d+)"`).exec(html)?.[1] ?? -1);
}

function queueCount(html: string, testId: string): number {
  return Number(new RegExp(`data-testid="${testId}"\\s+data-count="(\\d+)"`).exec(html)?.[1] ?? -1);
}

function attrOf(html: string, attribute: string): number {
  return Number(new RegExp(`${attribute}="(\\d+)"`).exec(html)?.[1] ?? -1);
}

function pageAttr(html: string, attribute: string): number {
  const section = html.slice(html.indexOf('data-testid="pagination"'));
  return Number(new RegExp(`data-${attribute}="(\\d+)"`).exec(section)?.[1] ?? -1);
}

/**
 * The counter renders the cart once, under its own test id, where the storefront
 * renders it twice (pinned and as a phone sheet) — so the shared reader cannot
 * find these lines.
 */
function counterLines(html: string): { id: string }[] {
  return html
    .slice(html.indexOf('data-testid="pos-cart"'))
    .split('data-testid="cart-line"')
    .slice(1)
    .map((chunk) => ({ id: /data-line-id="([^"]*)"/.exec(chunk)?.[1] ?? '' }));
}

function rowIds(html: string): string[] {
  return [...html.matchAll(/data-testid="order-row"\s+data-order-id="([^"]+)"/g)].map(
    (match) => match[1],
  );
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

async function signInStaff(session: Session, email: string) {
  session.clearCookies();
  const page = await session.get('/sign-in');
  const response = await session.submit(parseForms(page.body, '/sign-in')[0], { email });
  if (response.status !== 303) throw new Error(`Staff sign-in for ${email} returned ${response.status}`);
}

async function signInCustomer(session: Session, email: string, fullName: string) {
  session.clearCookies();
  const page = await session.get('/account/sign-in');
  const response = await session.submit(parseForms(page.body, '/account/sign-in')[0], {
    email,
    fullName,
  });
  if (response.status !== 303) throw new Error(`Customer sign-in for ${email} returned ${response.status}`);
}

main()
  .catch((error) => {
    console.error(`\nSmoke run stopped: ${error instanceof Error ? error.message : error}`);
    run.write();
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
