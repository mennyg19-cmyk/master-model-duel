import { existsSync } from 'node:fs';
import path from 'node:path';

import EmbeddedPostgres from 'embedded-postgres';

/**
 * Local Postgres for development and CI. There is no Docker or system Postgres
 * on the build machines, so the cluster ships as a dev dependency and runs on
 * this arm's assigned port. Hosted environments set DATABASE_URL instead and
 * never run this script.
 */
export const DB_PORT = 4104;
export const DB_USER = 'postgres';
export const DB_PASSWORD = 'postgres';
export const DB_NAME = 'tomchei';
export const DATABASE_URL = `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${DB_PORT}/${DB_NAME}?schema=public`;

/**
 * Tests truncate tables, so they get their own database. Anything that spawns
 * the test runner passes this explicitly: `--env-file` does not override a
 * DATABASE_URL that is already in the environment, and importing
 * `@prisma/client` puts the development one there.
 */
export const TEST_DB_NAME = 'tomchei_test';
export const TEST_DATABASE_URL = `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${DB_PORT}/${TEST_DB_NAME}?schema=public`;

const dataDirectory = path.resolve(process.cwd(), '.pgdata');

export function createCluster(): EmbeddedPostgres {
  return new EmbeddedPostgres({
    databaseDir: dataDirectory,
    user: DB_USER,
    password: DB_PASSWORD,
    port: DB_PORT,
    persistent: true,
    onLog: () => {},
    onError: (message) => console.error('[postgres]', message),
  });
}

/**
 * Database admin against an already-running cluster. `createDatabase` on the
 * class only works from the process that started Postgres, and the guard and
 * test scripts run separately from `npm run db:start`.
 */
async function runOnPostgresDatabase(sql: string): Promise<void> {
  const client = createCluster().getPgClient();
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

export async function ensureDatabase(name: string): Promise<void> {
  try {
    await runOnPostgresDatabase(`CREATE DATABASE "${assertPlainName(name)}"`);
  } catch (error) {
    const isDuplicate = (error as { code?: string }).code === '42P04';
    if (!isDuplicate) throw error;
  }
}

export async function dropDatabaseIfExists(name: string): Promise<void> {
  const safeName = assertPlainName(name);

  // A running dev server keeps a pool open, and Postgres refuses to drop a
  // database that still has sessions attached.
  await runOnPostgresDatabase(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
     WHERE datname = '${safeName}' AND pid <> pg_backend_pid()`,
  );
  await runOnPostgresDatabase(`DROP DATABASE IF EXISTS "${safeName}"`);
}

function assertPlainName(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`"${name}" is not a plain lowercase database name.`);
  }
  return name;
}

export async function startCluster(): Promise<EmbeddedPostgres> {
  const cluster = createCluster();

  if (!existsSync(path.join(dataDirectory, 'PG_VERSION'))) {
    console.log(`Initialising a new Postgres cluster in ${dataDirectory}`);
    await cluster.initialise();
  }

  await cluster.start();

  // Same narrow "already exists" handling the guard and test scripts use, so a
  // real failure — bad credentials, no disk — still surfaces instead of being
  // mistaken for a second run.
  await ensureDatabase(DB_NAME);

  return cluster;
}

async function main() {
  const cluster = await startCluster();
  console.log(`Postgres listening on 127.0.0.1:${DB_PORT} (database "${DB_NAME}")`);
  console.log(`DATABASE_URL=${DATABASE_URL}`);

  const shutdown = async () => {
    await cluster.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
