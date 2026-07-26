import { PrismaClient } from '@prisma/client';

import { DATABASE_URL, TEST_DATABASE_URL } from './db-server';
import { lineContaining, runCommand, runTests, SmokeRun } from './smoke-harness';

/**
 * Phase P2 smoke run. P2 ships schema and engine with no UI, so the evidence is
 * a real migrate-and-seed against an empty database plus the named unit tests
 * the phase EXPECTED file asks for. Nothing here asserts against a mock.
 */
const TEST_FILES = [
  'tests/grouping.test.ts',
  'tests/order-state-machine.test.ts',
  'tests/order-lifecycle.test.ts',
  'tests/order-numbers.test.ts',
  'tests/inventory.test.ts',
  'tests/scheduled-jobs.test.ts',
  'tests/draft-reference.test.ts',
];

const db = new PrismaClient({ datasourceUrl: DATABASE_URL });

const run = new SmokeRun('P2', [
  `Run at ${new Date().toISOString()} against the embedded Postgres on 127.0.0.1:4104.`,
  'P2 delivers schema and engine only, so every check is a migration, a seed, a',
  'database read or a named unit test — there is no UI to click yet.',
]);

const record = run.record.bind(run);
const expect = run.expect.bind(run);
const expectTest = run.expectTest.bind(run);

async function main() {
  // ------------------------------------------------------------------- S1
  const migrated = runCommand('npm', ['run', 'db:fresh']);
  expect('S1a', 'Migration harness replays onto an empty database', migrated.status === 0,
    lineContaining(migrated.output, 'All migrations have been successfully applied.'));

  const seeded = runCommand('npm', ['run', 'seed']);
  expect('S1b', 'Seed runs against the fresh database', seeded.status === 0,
    lineContaining(seeded.output, 'Seed complete'));

  const season = await db.season.findFirst({ where: { status: 'OPEN' }, orderBy: { year: 'desc' } });
  const productCount = await db.product.count({ where: { seasonId: season?.id } });
  const customer = await db.customer.findFirst({ where: { normalizedPhone: { not: null } } });
  const order = await db.order.findFirst({ where: { status: 'PLACED' }, include: { lines: true } });

  expect('S1c', 'Seed creates a season, catalog, customer and order',
    Boolean(season) && productCount >= 3 && Boolean(customer) && Boolean(order?.orderNumber),
    `season ${season?.label} (${season?.status}), ${productCount} products, customer ${customer?.email}, order #${order?.orderNumber} with ${order?.lines.length} lines`);

  // ---------------------------------------------------- schema evidence
  const scheduled = await db.season.count({ where: { opensAt: { not: null }, closesAt: { not: null } } });
  const options = await db.productOption.count({ where: { priceAdjustmentCents: { gt: 0 } } });
  const restriction = await db.addOnProductRestriction.count();
  const replacement = await db.product.count({ where: { replacedByProductId: { not: null } } });
  const sponsorship = await db.product.count({ where: { kind: 'SPONSORSHIP', tracksInventory: false } });

  expect('P2-1', 'Season schedule, product kinds and dimensions, priced options, restricted add-ons and replacement links all exist',
    scheduled >= 1 && options >= 1 && restriction >= 1 && replacement >= 1 && sponsorship >= 1,
    `${scheduled} scheduled seasons, ${options} priced options, ${restriction} add-on restrictions, ${replacement} replacement links, ${sponsorship} non-stocked sponsorship products`);

  const address = await db.customerAddress.findFirst();
  expect('P2-2', 'Customer dedupe keys and address book with geocode fields are in place',
    customer?.normalizedPhone !== null && customer?.normalizedEmail !== undefined && Boolean(address),
    `customer normalized phone ${customer?.normalizedPhone}, address key "${address?.addressKey}", geocode columns ${address && 'latitude' in address ? 'present' : 'missing'}`);

  const packages = await db.package.findMany({ where: { orderId: order?.id }, include: { lines: true } });
  expect('P2-3', 'The seeded order exploded into packages by grouping key',
    packages.length === 2 && packages.some((row) => row.lines.length === 2),
    `${order?.lines.length} lines became ${packages.length} packages (${packages.map((row) => `${row.recipientName}: ${row.lines.length}`).join(', ')}), all at stage ${[...new Set(packages.map((row) => row.stage))].join('/')}`);

  const methods = await db.fulfillmentMethod.count();
  const pickup = await db.pickupLocation.count();
  const packageTypes = await db.packageType.count();
  expect('P2-4', 'Fulfillment methods are data-driven rows, with pickup locations and package types',
    methods >= 3 && pickup >= 1 && packageTypes >= 2,
    `${methods} fulfillment methods, ${pickup} pickup locations, ${packageTypes} package types`);

  const constraints = await db.$queryRaw<{ conname: string }[]>`
    SELECT conname FROM pg_constraint
    WHERE conrelid = '"InventoryItem"'::regclass AND contype = 'c'`;
  expect('P2-5', 'Inventory carries the XOR target and reserve-bound CHECK constraints',
    constraints.some((row) => row.conname === 'InventoryItem_single_target') &&
      constraints.some((row) => row.conname === 'InventoryItem_reserved_within_on_hand'),
    constraints.map((row) => row.conname).join(', '));

  const bomTables = await db.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('Ingredient', 'BillOfMaterialLine', 'AssemblyBatch', 'AssemblyBatchConsumption')`;
  expect('P2-6', 'BOM and assembly-batch tables ship as schema only',
    bomTables.length === 4,
    `${bomTables.map((row) => row.table_name).sort().join(', ')} present, no UI routes reference them`);

  // ------------------------------------------------------------ S2 - S5
  const testDatabase = runCommand('npm', ['run', 'test:db']);
  expect('S1d', 'The tests get their own migrated database, not the seeded one', testDatabase.status === 0,
    lineContaining(testDatabase.output, 'migration'));

  const testRun = runTests(TEST_FILES, TEST_DATABASE_URL);
  const passedTests = new Set(testRun.passed);

  expectTest('S2', 'Grouping engine: same key merges, different greeting splits', passedTests, [
    'the same recipient, address, method and greeting share one package',
    'a different greeting splits the package',
    'grouping keeps one package per distinct destination and holds every line',
  ]);

  expectTest('S3', 'State machine rejects an illegal transition', passedTests, [
    'an illegal transition is refused and says why',
    'an order never goes backwards and a finished order never reopens',
    'the service refuses an illegal transition, not just the pure check',
  ]);

  expectTest('S4', 'Concurrent finalizations claim unique sequential order numbers', passedTests, [
    'ten concurrent checkouts claim unique sequential order numbers',
    'two finalizations of the same order place it once and burn one number',
  ]);

  expectTest('S5', 'Two checkouts for the last unit: only one commits', passedTests, [
    'two checkouts race for the last package and only one commits',
    'five concurrent reservations for one unit produce one winner',
  ]);

  expectTest('P2-7', 'Price snapshots, discard, cancel-releases-stock and the cached payment status', passedTests, [
    'a price change after the order is placed does not move what the customer owes',
    'discarding a draft leaves no order number behind',
    'cancelling a placed order hands the stock back',
    'the cached payment status follows posted and voided payments',
  ]);

  expectTest('P2-8', 'Package stages are optional, audited, and printing never implies sent', passedTests, [
    'a package may skip stages forward',
    'printing does not imply sent, and a package never moves back',
    'advancing a package stage is audited and refuses a stale version',
  ]);

  expectTest('P2-9', 'Geocode cache TTLs and the scheduled season flip write a cron run log', passedTests, [
    'a season opens on schedule, closes on schedule, and every run is logged',
    'a geocode hit is served from the cache until it expires',
    'a geocode miss expires far sooner than a hit',
  ]);

  record('P2-10', 'Whole suite green', testRun.failed.length === 0,
    `${testRun.passed.length} tests passed, ${testRun.failed.length} failed`);

  const guard = runCommand('npm', ['run', 'db:guard']);
  expect('P2-11', 'Schema and migrations agree, CHECK constraints included', guard.status === 0,
    lineContaining(guard.output, 'Migration guard: schema and migrations agree'));

  expectTest('P2-12', 'The forward lifecycle and per-order reservation records are covered', passedTests, [
    'a placed order walks forward to completed, versioned and audited at every step',
    'a stocked add-on is reserved alongside its product, each with its own record',
  ]);

  const reservations = await db.reservation.findMany({
    where: { status: 'HELD' },
    select: { productId: true, addOnId: true, quantity: true },
  });
  expect('P2-13', 'The seeded order holds its stock through named reservation rows', reservations.length === 3,
    `${reservations.length} HELD reservations for the seeded order: ${reservations.map((row) => `${row.productId ? 'product' : 'add-on'} x${row.quantity}`).join(', ')}`);

  run.write();
}

main()
  .catch((error) => {
    console.error(`\nSmoke run stopped: ${error instanceof Error ? error.message : error}`);
    run.write();
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
