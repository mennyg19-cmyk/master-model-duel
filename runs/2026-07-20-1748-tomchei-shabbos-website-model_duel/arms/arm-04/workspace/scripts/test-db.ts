import { spawnSync } from 'node:child_process';

import { ensureDatabase } from './db-server';

/**
 * Tests truncate tables, so they get their own database. Never point this at
 * the development database.
 */
const TEST_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:4104/tomchei_test?schema=public';

async function main() {
  await ensureDatabase('tomchei_test');

  const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });

  if (migrate.status !== 0) {
    console.error('Could not migrate the test database; is `npm run db:start` running?');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
