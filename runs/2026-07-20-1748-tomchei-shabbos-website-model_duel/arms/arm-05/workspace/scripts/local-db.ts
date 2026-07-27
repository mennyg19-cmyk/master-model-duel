import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

export const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:4105/tomchei_shabbos";
const databaseDir = join(process.cwd(), ".local-db", "postgres-17");

export function createLocalDatabase() {
  return new EmbeddedPostgres({
    databaseDir,
    user: "postgres",
    password: "postgres",
    port: 4105,
    persistent: true,
  });
}

function runExecutable(executable: string, args: string[]) {
  return new Promise<number | null>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", resolve);
  });
}

export async function stopLocalDatabase() {
  if (process.platform === "win32") {
    const pgCtl = join(
      process.cwd(),
      "node_modules",
      "@embedded-postgres",
      "windows-x64",
      "native",
      "bin",
      "pg_ctl.exe",
    );
    if (existsSync(pgCtl)) {
      await runExecutable(pgCtl, ["-D", databaseDir, "stop", "-m", "fast"]);
      return;
    }
  }
  await createLocalDatabase().stop();
}

async function isDatabaseReady(database: EmbeddedPostgres) {
  const client = database.getPgClient("postgres", "127.0.0.1");
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out connecting to PostgreSQL.")), 2_000);
      }),
    ]);
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
    await client.end().catch(() => undefined);
  }
}

export async function startLocalDatabase() {
  const database = createLocalDatabase();
  if (!await isDatabaseReady(database)) {
    if (!existsSync(join(databaseDir, "PG_VERSION"))) await database.initialise();
    await database.start();
  }

  const client = database.getPgClient("postgres", "127.0.0.1");
  await client.connect();
  const existing = await client.query(
    "SELECT 1 FROM pg_database WHERE datname = 'tomchei_shabbos'",
  );
  await client.end();
  if (existing.rowCount === 0) await database.createDatabase("tomchei_shabbos");
  return database;
}

export async function runWithLocalDatabase(command: string, args: string[]) {
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(executable, [command, ...args], {
      env: { ...process.env, DATABASE_URL: LOCAL_DATABASE_URL },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (exitCode !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${exitCode}.`);
}
