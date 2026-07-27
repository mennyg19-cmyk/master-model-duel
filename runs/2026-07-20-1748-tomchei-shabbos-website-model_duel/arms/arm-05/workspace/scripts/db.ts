import { LOCAL_DATABASE_URL, runWithLocalDatabase, startLocalDatabase, stopLocalDatabase } from "./local-db";

const command = process.argv[2];

async function keepDatabaseRunning() {
  const database = await startLocalDatabase();
  console.log(`Embedded PostgreSQL is listening at ${LOCAL_DATABASE_URL}`);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await database.stop();
}

async function runDatabaseCommand() {
  if (command === "start") return keepDatabaseRunning();
  if (command === "stop") return stopLocalDatabase();
  if (command === "migrate") return runWithLocalDatabase("prisma", ["migrate", "deploy"]);
  if (command === "seed") return runWithLocalDatabase("tsx", ["prisma/seed.ts"]);
  throw new Error("Use db:start, db:stop, db:migrate, or db:seed.");
}

void runDatabaseCommand().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
