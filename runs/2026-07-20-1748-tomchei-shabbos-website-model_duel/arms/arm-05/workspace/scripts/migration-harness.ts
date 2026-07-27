import { runWithLocalDatabase } from "./local-db";

async function verifyMigrations() {
  await runWithLocalDatabase("prisma", ["migrate", "deploy"]);
  await runWithLocalDatabase("prisma", ["migrate", "status"]);
  console.log("Migration harness: migrations deployed and status checked against embedded PostgreSQL.");
}

void verifyMigrations();
