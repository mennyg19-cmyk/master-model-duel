import EmbeddedPostgres from "embedded-postgres";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dataDir = path.join(root, ".pgdata");
const port = Number(process.env.DB_PORT || 4103);

async function main() {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: true,
  });

  const alreadyInit = fs.existsSync(path.join(dataDir, "PG_VERSION"));
  if (!alreadyInit) {
    console.log(`Initializing embedded Postgres in ${dataDir}`);
    await db.initialise();
  }

  console.log(`Starting Postgres on 127.0.0.1:${port}`);
  await db.start();
  try {
    await db.createDatabase("tomchei");
    console.log("Created database tomchei");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists/i.test(message)) {
      console.log(`createDatabase note: ${message}`);
    }
  }

  console.log(`Postgres ready — DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${port}/tomchei?schema=public`);
  console.log("Leave this process running. Ctrl+C stops the database.");

  const stop = async () => {
    console.log("Stopping Postgres…");
    await db.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
