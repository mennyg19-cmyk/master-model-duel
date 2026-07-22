import EmbeddedPostgres from "embedded-postgres";

// Long-running dev database on port 4103. Keep this process alive while developing;
// Ctrl+C stops the cluster cleanly. Data persists in .pgdata between runs.
async function main() {
  const postgres = new EmbeddedPostgres({
    databaseDir: "./.pgdata",
    user: "duel",
    password: "duel",
    port: 4103,
    persistent: true,
  });

  const isFreshCluster = !(await import("fs")).existsSync("./.pgdata/PG_VERSION");
  if (isFreshCluster) await postgres.initialise();
  await postgres.start();

  const client = postgres.getPgClient();
  await client.connect();
  const existing = await client.query(
    "SELECT datname FROM pg_database WHERE datname IN ('tomchei', 'shadow')"
  );
  const existingNames = existing.rows.map((row: { datname: string }) => row.datname);
  if (!existingNames.includes("tomchei")) await postgres.createDatabase("tomchei");
  // Shadow database used by the prisma migration guard.
  if (!existingNames.includes("shadow")) await postgres.createDatabase("shadow");
  await client.end();

  console.log("Postgres ready on 127.0.0.1:4103 (databases: tomchei, shadow). Ctrl+C to stop.");

  const shutdown = async () => {
    console.log("Stopping Postgres...");
    await postgres.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Failed to start embedded Postgres:", error);
  process.exit(1);
});

