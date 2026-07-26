import { spawnSync } from 'node:child_process';

import { ensureDatabase, TEST_DATABASE_URL, TEST_DB_NAME } from './db-server';

/** Creates and migrates the database the tests are allowed to truncate. */
async function main() {
  await ensureDatabase(TEST_DB_NAME);

  const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });

  // `embedded-postgres` installs an async exit hook that ends the process with
  // 0 whatever `process.exitCode` says, so `npm test` would otherwise run
  // against an unmigrated database instead of stopping here.
  if (migrate.status !== 0) {
    console.error('Could not migrate the test database; is `npm run db:start` running?');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
