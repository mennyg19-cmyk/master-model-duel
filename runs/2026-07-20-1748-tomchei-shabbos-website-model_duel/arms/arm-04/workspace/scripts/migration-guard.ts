import { spawnSync } from 'node:child_process';

import { PrismaClient } from '@prisma/client';

import { DATABASE_URL, dropDatabaseIfExists, ensureDatabase } from './db-server';

/**
 * Fails CI when prisma/schema has drifted away from the committed migrations.
 * `migrate diff` replays the migration folder into a throwaway shadow database
 * and compares the result with the schema.
 */
const SHADOW_DATABASE = 'tomchei_migration_shadow';

/**
 * Prisma's schema language cannot express a CHECK constraint, so `migrate diff`
 * cannot compare one either: deleting these lines from a migration would leave
 * the guard green while the database lost its last defence against overselling.
 * They are asserted against the replayed migrations instead.
 */
const REQUIRED_CHECK_CONSTRAINTS = [
  'InventoryItem.InventoryItem_single_target',
  'InventoryItem.InventoryItem_reserved_within_on_hand',
  'Reservation.Reservation_single_target',
  'Reservation.Reservation_quantity_positive',
];

/**
 * `embedded-postgres` installs an async exit hook that ends the process with 0
 * whatever `process.exitCode` says, so a guard that only sets the field passes
 * CI while reporting a failure. Every exit here is explicit.
 */
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main() {
  const shadowUrl = DATABASE_URL.replace(/\/[^/?]+\?/, `/${SHADOW_DATABASE}?`);

  await dropDatabaseIfExists(SHADOW_DATABASE);
  await ensureDatabase(SHADOW_DATABASE);

  const diff = spawnSync(
    'npx',
    [
      'prisma',
      'migrate',
      'diff',
      '--from-migrations',
      'prisma/migrations',
      '--to-schema-datamodel',
      'prisma/schema',
      '--shadow-database-url',
      shadowUrl,
      '--exit-code',
    ],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );

  if (diff.status !== 0) {
    await dropDatabaseIfExists(SHADOW_DATABASE);
    fail(
      'Migration guard failed: prisma/schema differs from the committed migrations. ' +
        'Run `npm run db:migrate` and commit the generated migration.',
    );
  }

  const missing = await missingCheckConstraints(shadowUrl);
  await dropDatabaseIfExists(SHADOW_DATABASE);

  if (missing.length > 0) {
    fail(
      `Migration guard failed: the migrations no longer create ${missing.join(', ')}. ` +
        'These CHECK constraints are hand-written and must be restored in a migration.',
    );
  }

  console.log(
    `Migration guard: schema and migrations agree, and all ${REQUIRED_CHECK_CONSTRAINTS.length} CHECK constraints survive the replay.`,
  );
}

async function missingCheckConstraints(shadowUrl: string): Promise<string[]> {
  // `migrate diff` leaves its replay behind, and `migrate deploy` refuses to run
  // against a schema that is not empty.
  await dropDatabaseIfExists(SHADOW_DATABASE);
  await ensureDatabase(SHADOW_DATABASE);

  const deployed = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: shadowUrl },
  });

  if (deployed.status !== 0) throw new Error('The migrations could not be replayed into the shadow database.');

  const shadow = new PrismaClient({ datasourceUrl: shadowUrl });

  try {
    const present = await shadow.$queryRaw<{ qualifiedName: string }[]>`
      SELECT replace(conrelid::regclass::text, '"', '') || '.' || conname AS "qualifiedName"
      FROM pg_constraint
      WHERE contype = 'c' AND connamespace = 'public'::regnamespace`;

    const found = new Set(present.map((row) => row.qualifiedName));
    return REQUIRED_CHECK_CONSTRAINTS.filter((constraint) => !found.has(constraint));
  } finally {
    await shadow.$disconnect();
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
