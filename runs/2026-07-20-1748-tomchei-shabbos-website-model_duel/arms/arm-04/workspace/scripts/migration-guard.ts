import { spawnSync } from 'node:child_process';

import { DATABASE_URL, dropDatabaseIfExists, ensureDatabase } from './db-server';

/**
 * Fails CI when prisma/schema.prisma has drifted away from the committed
 * migrations. `migrate diff` replays the migration folder into a throwaway
 * shadow database and compares the result with the schema file.
 */
const SHADOW_DATABASE = 'tomchei_migration_shadow';

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
      'prisma/schema.prisma',
      '--shadow-database-url',
      shadowUrl,
      '--exit-code',
    ],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );

  await dropDatabaseIfExists(SHADOW_DATABASE);

  if (diff.status === 0) {
    console.log('Migration guard: schema and migrations agree.');
    return;
  }

  console.error(
    'Migration guard failed: prisma/schema.prisma differs from the committed migrations. ' +
      'Run `npm run db:migrate` and commit the generated migration.',
  );
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
