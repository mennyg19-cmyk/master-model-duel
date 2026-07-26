import { spawnSync } from 'node:child_process';

import { DATABASE_URL, DB_NAME, DB_PORT, dropDatabaseIfExists, ensureDatabase } from './db-server';

/**
 * Drops and recreates the local development database, then replays migrations.
 * Used to prove the first-run bootstrap path against a genuinely empty schema.
 *
 * It refuses to touch anything that is not the embedded cluster on this arm's
 * port, so it cannot be pointed at a shared or hosted database by accident.
 */
const LOCAL_HOSTS = [`127.0.0.1:${DB_PORT}`, `localhost:${DB_PORT}`];

async function main() {
  const target = process.env.DATABASE_URL ?? DATABASE_URL;

  if (!LOCAL_HOSTS.some((host) => target.includes(host))) {
    throw new Error(
      `Refusing to wipe ${target}. This script only resets the embedded cluster on port ${DB_PORT}.`,
    );
  }

  await dropDatabaseIfExists(DB_NAME);
  await ensureDatabase(DB_NAME);
  console.log(`Recreated empty database "${DB_NAME}"`);

  const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: target },
  });

  if (migrate.status !== 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
