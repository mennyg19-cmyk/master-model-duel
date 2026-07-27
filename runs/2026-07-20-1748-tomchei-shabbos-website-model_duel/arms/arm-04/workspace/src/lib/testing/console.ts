import 'server-only';

import { recordAudit } from '../audit';
import type { StaffContext } from '../auth/staff';
import { failure, ok, type Result } from '../core/result';
import { db } from '../db';
import { priorYearContext, writePriorYearOrder } from '../imports/prior-year-orders';
import { runInTransaction } from '../transaction';
import { isTestMode } from './test-mode';

/**
 * The three buttons that make a rehearsal repeatable (R-014, R-103).
 *
 * Seeding, resetting and wiping all refuse unless test mode is on, and the
 * check is here rather than on the screen. A screen-level check is one
 * hand-written URL away from being no check at all, and what is behind these
 * buttons is `deleteMany` over the orders table.
 *
 * Nothing here touches staff, permissions, settings or the catalogue. Wiping is
 * "put the orders back to nothing so we can rehearse again", not "reinstall the
 * software": losing the season's products and the office's shipping origin
 * would turn a two-minute reset into an afternoon.
 */
export const CONSOLE_NOT_IN_TEST_MODE = 'console_not_in_test_mode';
export const CONSOLE_NO_SEASON = 'console_no_season';

export type SeedSummary = { ordersWritten: number; customersWritten: number };
export type ClearSummary = { ordersDeleted: number; customersDeleted: number };

const SEED_ITEMS = [
  { slug: 'demo-classic-box', name: 'Demo classic box', priceCents: 3600 },
  { slug: 'demo-deluxe-box', name: 'Demo deluxe box', priceCents: 5400 },
];

/**
 * Demo orders written through the historic-order writer, which already creates
 * the customer, the address book entry, the catalogue row and the order in one
 * transaction. A second seeding routine alongside it would be a second
 * definition of what a complete order looks like.
 */
export async function seedTestData(
  staff: StaffContext,
  input: { seasonYear: number; householdCount: number },
): Promise<Result<SeedSummary>> {
  const guard = await requireTestMode();
  if (!guard.ok) return guard;

  const context = await priorYearContext(input.seasonYear);
  if (!context.ok) return context;

  let ordersWritten = 0;
  let customersWritten = 0;

  for (let index = 0; index < input.householdCount; index += 1) {
    const item = SEED_ITEMS[index % SEED_ITEMS.length];
    const number = index + 1;

    const written = await runInTransaction((tx) =>
      writePriorYearOrder(tx, context.value, {
        reference: `DEMO-${input.seasonYear}-${String(number).padStart(4, '0')}`,
        seasonYear: input.seasonYear,
        customerEmail: `demo${number}@example.test`,
        customerName: `Demo Household ${number}`,
        placedAt: new Date(),
        lines: [
          {
            productSlug: item.slug,
            productName: item.name,
            quantity: 1,
            unitPriceCents: item.priceCents,
            recipientName: `Demo Recipient ${number}`,
            address: {
              line1: `${100 + number} Demo Street`,
              city: 'Brooklyn',
              state: 'NY',
              postalCode: '11219',
            },
            greetingMessage: 'A freilichen Purim from the rehearsal.',
          },
        ],
      }),
    );

    if (!written.ok) return written;

    ordersWritten += 1;
    if (written.value.customerCreated) customersWritten += 1;
  }

  await recordConsoleRun(staff, 'seed', input.seasonYear);
  return ok({ ordersWritten, customersWritten });
}

/** One season's orders, and nothing else. The catalogue and the season stay. */
export async function resetSeason(
  staff: StaffContext,
  seasonYear: number,
): Promise<Result<ClearSummary>> {
  const guard = await requireTestMode();
  if (!guard.ok) return guard;

  const season = await db.season.findUnique({ where: { year: seasonYear } });
  if (!season) return failure(CONSOLE_NO_SEASON, `There is no ${seasonYear} season.`);

  const deleted = await db.order.deleteMany({ where: { seasonId: season.id } });

  await recordConsoleRun(staff, 'reset', seasonYear);
  return ok({ ordersDeleted: deleted.count, customersDeleted: 0 });
}

/**
 * Every order and every household, in that order — a customer with orders
 * cannot be deleted, which is the database refusing to leave an order pointing
 * at nobody. The address books go with their customers.
 *
 * The reconciliation sweeps go with their findings: a run header reading
 * "checked 3, flagged 1" over an empty queue is a screen describing a season
 * that no longer exists.
 *
 * What deliberately survives a wipe: the audit trail, the export history and
 * the cron run log. All three are records of what people and schedules did to
 * this deployment, not records of the rehearsal data, and a console button that
 * erased the audit trail would be the one hole in it.
 */
export async function wipeTransactionalData(staff: StaffContext): Promise<Result<ClearSummary>> {
  const guard = await requireTestMode();
  if (!guard.ok) return guard;

  const orders = await db.order.deleteMany({});
  const customers = await db.customer.deleteMany({});

  await Promise.all([
    db.deliveryRoute.deleteMany({}),
    db.printBatch.deleteMany({}),
    db.notificationLog.deleteMany({}),
    db.legacyImportRun.deleteMany({}),
    db.addressCleanupFlag.deleteMany({}),
    db.paymentReconciliationFlag.deleteMany({}),
    db.paymentReconciliationRun.deleteMany({}),
  ]);

  await recordConsoleRun(staff, 'wipe', null);
  return ok({ ordersDeleted: orders.count, customersDeleted: customers.count });
}

async function requireTestMode(): Promise<Result<true>> {
  if (await isTestMode()) return ok(true);

  return failure(
    CONSOLE_NOT_IN_TEST_MODE,
    'The test console only works while this deployment is in test mode.',
  );
}

function recordConsoleRun(
  staff: StaffContext,
  action: 'seed' | 'reset' | 'wipe',
  seasonYear: number | null,
) {
  return recordAudit(staff, {
    action: 'testing.console_ran',
    entityType: 'TestConsole',
    entityId: action,
    detail: { action, seasonYear },
  });
}
