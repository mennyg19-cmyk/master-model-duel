import { PrismaClient } from '@prisma/client';

import { DATABASE_URL } from './db-server';

/**
 * Crunch-scale fixtures (G-024).
 *
 * A thousand orders and five thousand packages, which is roughly what the org
 * carries into Purim week. The admin lists are written to be bounded and
 * indexed; this is what makes that claim checkable rather than asserted, and
 * the smoke run times the same pages against it.
 *
 * Everything it writes is marked, so it can be run again and cleared without
 * touching the seeded demo data:
 *
 *   npm run fixtures:scale          # create
 *   npm run fixtures:scale -- clear # remove
 */
const ORDERS = Number(process.env.SCALE_ORDERS ?? 1_000);
const PACKAGES_PER_ORDER = Number(process.env.SCALE_PACKAGES_PER_ORDER ?? 5);
const CHUNK = 500;

/** Every fixture row carries this, so `clear` is exact. */
const MARK = 'scale-fixture';
const EMAIL_DOMAIN = 'scale.example.test';
const ORDER_NUMBER_BASE = 900_000;

const db = new PrismaClient({ datasourceUrl: DATABASE_URL });

async function main() {
  if (process.argv.includes('clear')) return clear();

  const season = await db.season.findFirstOrThrow({
    where: { status: 'OPEN' },
    orderBy: { year: 'desc' },
  });
  const method = await db.fulfillmentMethod.findFirstOrThrow({ where: { isActive: true } });
  const product = await db.product.findFirstOrThrow({ where: { seasonId: season.id } });

  await clear();
  const started = Date.now();

  const customers = await createCustomers();
  const orderIds = await createOrders(season.id, customers);
  await createLinesAndPackages(orderIds, method.id, product);

  // Six thousand rows arrived in bulk, and until the planner is told, it is
  // still planning for the empty tables it last measured — which turns an
  // indexed read of one season into a scan. Every bulk loader owes the database
  // this, and timing a page against stale statistics measures nothing.
  await db.$executeRawUnsafe('ANALYZE');

  const [orderCount, packageCount, lineCount] = await Promise.all([
    db.order.count({ where: { seasonId: season.id, orderNumber: { gte: ORDER_NUMBER_BASE } } }),
    db.package.count({ where: { greetingMessage: MARK } }),
    db.orderLine.count({ where: { orderId: { in: orderIds.slice(0, CHUNK) } } }),
  ]);

  console.log(
    `Wrote ${orderCount} orders, ${packageCount} packages and ${lineCount} lines (first ${CHUNK} orders) ` +
      `into ${season.label} in ${Math.round((Date.now() - started) / 1000)}s.`,
  );
}

async function createCustomers(): Promise<{ id: string }[]> {
  const rows = Array.from({ length: ORDERS }, (_, index) => ({
    email: `scale-${index}@${EMAIL_DOMAIN}`,
    normalizedEmail: `scale-${index}@${EMAIL_DOMAIN}`,
    fullName: `${SURNAMES[index % SURNAMES.length]}, ${GIVEN_NAMES[index % GIVEN_NAMES.length]}`,
  }));

  for (const batch of chunks(rows)) {
    await db.customer.createMany({ data: batch, skipDuplicates: true });
  }

  return db.customer.findMany({
    where: { normalizedEmail: { endsWith: `@${EMAIL_DOMAIN}` } },
    select: { id: true },
    orderBy: { normalizedEmail: 'asc' },
  });
}

async function createOrders(seasonId: string, customers: { id: string }[]): Promise<string[]> {
  const placedFrom = Date.now() - ORDERS * 60_000;

  const rows = customers.map((customer, index) => ({
    seasonId,
    customerId: customer.id,
    draftReference: `D-SCAL-${String(index).padStart(5, '0')}`,
    orderNumber: ORDER_NUMBER_BASE + index,
    status: STATUSES[index % STATUSES.length],
    paymentStatus: index % 3 === 0 ? ('UNPAID' as const) : ('PAID' as const),
    subtotalCents: 3_600 + (index % 7) * 500,
    fulfillmentFeeCents: 500,
    totalCents: 4_100 + (index % 7) * 500,
    amountPaidCents: index % 3 === 0 ? 0 : 4_100 + (index % 7) * 500,
    placedAt: new Date(placedFrom + index * 60_000),
  }));

  for (const batch of chunks(rows)) {
    await db.order.createMany({ data: batch, skipDuplicates: true });
  }

  const orders = await db.order.findMany({
    where: { seasonId, orderNumber: { gte: ORDER_NUMBER_BASE } },
    select: { id: true },
    orderBy: { orderNumber: 'asc' },
  });

  return orders.map((order) => order.id);
}

async function createLinesAndPackages(
  orderIds: string[],
  fulfillmentMethodId: string,
  product: { id: string; name: string; priceCents: number },
): Promise<void> {
  const packages = orderIds.flatMap((orderId, orderIndex) =>
    Array.from({ length: PACKAGES_PER_ORDER }, (_, boxIndex) => ({
      orderId,
      groupingKey: `${MARK}-${boxIndex}`,
      recipientName: `${GIVEN_NAMES[(orderIndex + boxIndex) % GIVEN_NAMES.length]} ${
        SURNAMES[(orderIndex + boxIndex) % SURNAMES.length]
      }`,
      fulfillmentMethodId,
      addressLine1: `${100 + boxIndex} Forest Avenue`,
      addressCity: 'Lakewood',
      addressState: 'NJ',
      addressPostalCode: '08701',
      addressCountry: 'US',
      greetingMessage: MARK,
      fulfillmentFeeCents: 500,
      stage: BOX_STAGES[(orderIndex + boxIndex) % BOX_STAGES.length],
    })),
  );

  for (const batch of chunks(packages)) {
    await db.package.createMany({ data: batch, skipDuplicates: true });
  }

  // Lines are what make an order detail page heavy, so the first few hundred
  // orders carry real ones. Writing a line for all five thousand boxes would
  // add minutes to the fixture run without changing what the lists have to do.
  const detailed = orderIds.slice(0, CHUNK);
  const lines = detailed.map((orderId, index) => ({
    orderId,
    productId: product.id,
    quantity: 1 + (index % 3),
    productNameSnapshot: product.name,
    unitPriceCents: product.priceCents,
    lineTotalCents: product.priceCents * (1 + (index % 3)),
    recipientName: `${GIVEN_NAMES[index % GIVEN_NAMES.length]} ${SURNAMES[index % SURNAMES.length]}`,
    fulfillmentMethodId,
    addressLine1: '412 Forest Avenue',
    addressCity: 'Lakewood',
    addressState: 'NJ',
    addressPostalCode: '08701',
    addressCountry: 'US',
    greetingMessage: MARK,
  }));

  for (const batch of chunks(lines)) {
    await db.orderLine.createMany({ data: batch });
  }
}

async function clear(): Promise<void> {
  const orders = await db.order.findMany({
    where: { draftReference: { startsWith: 'D-SCAL-' } },
    select: { id: true },
  });
  const ids = orders.map((order) => order.id);

  for (const batch of chunks(ids)) {
    await db.orderLine.deleteMany({ where: { orderId: { in: batch } } });
    await db.package.deleteMany({ where: { orderId: { in: batch } } });
    await db.order.deleteMany({ where: { id: { in: batch } } });
  }

  await db.customer.deleteMany({ where: { normalizedEmail: { endsWith: `@${EMAIL_DOMAIN}` } } });
}

const STATUSES = ['PLACED', 'PLACED', 'IN_FULFILLMENT', 'COMPLETED'] as const;
const BOX_STAGES = ['NEW', 'NEW', 'PRINTED', 'PACKED', 'SENT'] as const;

const GIVEN_NAMES = ['Miriam', 'Yosef', 'Chana', 'Dovid', 'Rivka', 'Shmuel', 'Leah', 'Aharon'];
const SURNAMES = ['Klein', 'Stein', 'Friedman', 'Katz', 'Weiss', 'Berger', 'Roth', 'Adler'];

function* chunks<T>(rows: T[]): Generator<T[]> {
  for (let index = 0; index < rows.length; index += CHUNK) {
    yield rows.slice(index, index + CHUNK);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
